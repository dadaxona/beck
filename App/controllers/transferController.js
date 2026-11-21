const { Op } = require('sequelize');
const { sequelize, StockTransfer, StockTransferItem, StockBalance, Product, Warehouse, User } = require('../../models');
const { today } = require('../utils/date');
const { EPS, roundQty } = require('../utils/qty');

/*
 * Ombordan omborga ko'chirish hujjatlari.
 *  - Yaratish: "qayerdan" omborida qoldiq yetarli bo'lishi shart; tovar u yerdan ayrilib "qayerga" qo'shiladi.
 *  - O'chirishga belgilash (X): harakat orqaga qaytariladi ("qayerga" omborida qoldiq yetarli bo'lsa).
 *  - Tiklash: harakat qayta bajariladi. Butunlay o'chirish: faqat belgilangan hujjat.
 */

const fail = (status, message) => Object.assign(new Error(message), { status });

const include = [
  { model: Warehouse, as: 'from', attributes: ['id', 'name'] },
  { model: Warehouse, as: 'to', attributes: ['id', 'name'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
  {
    model: StockTransferItem,
    as: 'items',
    include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'barcode', 'unit', 'image'] }],
  },
];

const plain = (doc) => {
  const j = doc.toJSON();
  j.items = (j.items || []).sort((a, b) => a.id - b.id);
  j.quantity = roundQty(j.items.reduce((s, i) => s + i.quantity, 0));
  return j;
};

const load = async (id) => {
  const doc = await StockTransfer.findByPk(id, { include });
  return doc ? plain(doc) : null;
};

/** Qoldiqni o'zgartirish. Manfiyga tushsa xato (tovar nomi bilan). */
async function move(items, fromId, toId, t) {
  const need = new Map();
  for (const i of items) need.set(i.productId, roundQty((need.get(i.productId) || 0) + i.quantity));

  const products = await Product.findAll({ where: { id: [...need.keys()] }, attributes: ['id', 'name'], transaction: t });
  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  for (const [productId, qty] of need) {
    const src = await StockBalance.findOne({ where: { productId, warehouseId: fromId }, transaction: t });
    if (!src || src.quantity < qty - EPS) {
      const from = await Warehouse.findByPk(fromId, { transaction: t });
      throw fail(400, `Qoldiq yetarli emas: ${nameOf.get(productId) || productId} ("${from ? from.name : ''}" omborida bor: ${src ? roundQty(src.quantity) : 0})`);
    }
    await src.update({ quantity: roundQty(src.quantity - qty) }, { transaction: t });
    const [dst] = await StockBalance.findOrCreate({ where: { productId, warehouseId: toId }, defaults: { quantity: 0 }, transaction: t });
    await dst.update({ quantity: roundQty(dst.quantity + qty) }, { transaction: t });
  }
}

// GET /transfers?from=&to=&warehouseId=
exports.list = async (req, res) => {
  const { from, to, warehouseId } = req.query;
  const where = {};
  if (from && to) where.date = { [Op.between]: [from, to] };
  else if (from) where.date = { [Op.gte]: from };
  else if (to) where.date = { [Op.lte]: to };
  if (warehouseId) where[Op.or] = [{ fromWarehouseId: Number(warehouseId) }, { toWarehouseId: Number(warehouseId) }];
  const rows = await StockTransfer.findAll({ where, include, order: [['date', 'DESC'], ['id', 'DESC']] });
  res.json(rows.map(plain));
};

exports.get = async (req, res) => {
  const doc = await load(Number(req.params.id));
  if (!doc) throw fail(404, 'Hujjat topilmadi');
  res.json(doc);
};

// POST /transfers { fromWarehouseId, toWarehouseId, date?, comment, items: [{ productId, quantity }] }
exports.create = async (req, res) => {
  const b = req.body || {};
  const fromId = Number(b.fromWarehouseId);
  const toId = Number(b.toWarehouseId);
  if (!fromId || !toId) throw fail(400, 'Omborlarni tanlang');
  if (fromId === toId) throw fail(400, "Qayerdan va qayerga omborlari bir xil bo'lishi mumkin emas");
  const [fromW, toW] = await Promise.all([Warehouse.findByPk(fromId), Warehouse.findByPk(toId)]);
  if (!fromW || !toW) throw fail(404, 'Ombor topilmadi');

  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ productId: Number(i.productId), quantity: roundQty(i.quantity) }));
  if (!items.length) throw fail(400, "Tovar qo'shing");
  if (items.some((i) => !i.productId || !(i.quantity > 0))) throw fail(400, "Soni 0 dan katta bo'lishi kerak");
  const gone = await Product.findOne({ where: { id: items.map((i) => i.productId), deleted: true }, attributes: ['name'] });
  if (gone) throw fail(400, `Tovar o'chirilgan: ${gone.name}`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : today();

  const id = await sequelize.transaction(async (t) => {
    await move(items, fromId, toId, t);
    const doc = await StockTransfer.create(
      { date, comment: String(b.comment || '').slice(0, 1000), fromWarehouseId: fromId, toWarehouseId: toId, userId: req.user.id },
      { transaction: t },
    );
    await doc.update({ number: `KO-${doc.id}` }, { transaction: t });
    await StockTransferItem.bulkCreate(items.map((i) => ({ ...i, transferId: doc.id })), { transaction: t });
    return doc.id;
  });
  res.status(201).json(await load(id));
};

async function toggle(req, res, deleted) {
  const doc = await StockTransfer.findByPk(req.params.id, { include: [{ model: StockTransferItem, as: 'items' }] });
  if (!doc) throw fail(404, 'Hujjat topilmadi');
  if (doc.deleted === deleted) return res.json(await load(doc.id));
  const items = doc.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
  await sequelize.transaction(async (t) => {
    // O'chirish: tovar orqaga (qayerga -> qayerdan); tiklash: qaytadan (qayerdan -> qayerga)
    if (deleted) await move(items, doc.toWarehouseId, doc.fromWarehouseId, t);
    else await move(items, doc.fromWarehouseId, doc.toWarehouseId, t);
    await doc.update({ deleted }, { transaction: t });
  });
  res.json(await load(doc.id));
}

exports.remove = (req, res) => toggle(req, res, true);
exports.restore = (req, res) => toggle(req, res, false);

exports.purge = async (req, res) => {
  const doc = await StockTransfer.findByPk(req.params.id);
  if (!doc) throw fail(404, 'Hujjat topilmadi');
  if (!doc.deleted) throw fail(400, "Avval o'chirishga belgilang");
  await sequelize.transaction(async (t) => {
    await StockTransferItem.destroy({ where: { transferId: doc.id }, transaction: t });
    await doc.destroy({ transaction: t });
  });
  res.json({ ok: true });
};
