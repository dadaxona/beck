const { sequelize, WriteOff, WriteOffReturn, Product, StockBalance, Warehouse, User } = require('../../models');
const currencies = require('../services/currencies');
const { today } = require('../utils/date');
const { EPS, roundQty } = require('../utils/qty');

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v) || 0;
const round = (v) => Math.round(v * 100) / 100;

const include = [
  { model: Product, as: 'product', attributes: ['id', 'name', 'barcode'] },
  { model: Warehouse, as: 'warehouse', attributes: ['id', 'name'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
  { model: WriteOffReturn, as: 'returns', attributes: ['id', 'date', 'quantity', 'comment'] },
];

const load = (id) => WriteOff.findByPk(id, { include });

/** Qaytarilgan son, hozir spisatda qolgan son va zarar summasi bilan */
const view = (w) => {
  const json = w.toJSON();
  const returnedQty = roundQty((json.returns || []).reduce((s, r) => s + r.quantity, 0));
  const remaining = roundQty(json.quantity - returnedQty);
  return { ...json, returnedQty, remaining, loss: round(remaining * json.costPrice) };
};

/** Omborga qo'shish (+) yoki ayirish (-). Qoldiq manfiy bo'la olmaydi. */
async function changeStock(productId, warehouseId, delta, t) {
  const [balance] = await StockBalance.findOrCreate({
    where: { productId, warehouseId },
    defaults: { quantity: 0 },
    transaction: t,
  });
  const quantity = roundQty(balance.quantity + delta);
  if (quantity < -EPS) {
    const product = await Product.findByPk(productId, { transaction: t });
    throw fail(400, `Qoldiq yetarli emas: ${product?.name ?? productId} (bor: ${roundQty(balance.quantity)})`);
  }
  await balance.update({ quantity }, { transaction: t });
}

exports.list = async (req, res) => {
  const rows = await WriteOff.findAll({ include, order: [['date', 'DESC'], ['id', 'DESC']] });
  res.json(rows.map(view));
};

// Spisat: tovar tanlanadi, soni kiritiladi -> omborda kamayadi, spisat ro'yxatiga yoziladi
exports.create = async (req, res) => {
  const b = req.body || {};
  const quantity = roundQty(num(b.quantity));
  if (!b.productId) throw fail(400, 'Tovarni tanlang');
  if (!b.warehouseId) throw fail(400, 'Omborni tanlang');
  if (!(quantity > 0)) throw fail(400, "Soni 0 dan katta bo'lishi kerak");

  const id = await sequelize.transaction(async (t) => {
    const product = await Product.findByPk(b.productId, { transaction: t });
    if (!product) throw fail(400, 'Tovar topilmadi');
    if (product.deleted) throw fail(400, `Tovar o'chirilgan: ${product.name}`);
    if (!(await Warehouse.findByPk(b.warehouseId, { transaction: t }))) throw fail(400, 'Omborni tanlang');

    await changeStock(product.id, b.warehouseId, -quantity, t);

    const doc = await WriteOff.create(
      {
        date: b.date || today(),
        currency: product.currency || 'UZS',
        rate: await currencies.rateOf(product.currency || 'UZS'),
        productId: product.id,
        warehouseId: b.warehouseId,
        quantity,
        costPrice: product.purchasePrice,
        sum: round(quantity * product.purchasePrice),
        comment: String(b.comment || '').trim(),
        posted: true,
        userId: req.user.id,
      },
      { transaction: t },
    );
    await doc.update({ number: `SP-${doc.id}` }, { transaction: t });
    return doc.id;
  });

  res.status(201).json(view(await load(id)));
};

// Qaytarish: spisat qilingan tovarning (qisman yoki to'liq) soni omborga qaytadi
exports.returnBack = async (req, res) => {
  const b = req.body || {};
  const quantity = roundQty(num(b.quantity));
  if (!(quantity > 0)) throw fail(400, "Soni 0 dan katta bo'lishi kerak");

  await sequelize.transaction(async (t) => {
    const doc = await WriteOff.findByPk(req.params.id, { include, transaction: t });
    if (!doc) throw fail(404, 'Hujjat topilmadi');
    if (doc.deleted || !doc.posted) throw fail(400, "O'chirilgan hujjatni o'zgartirib bo'lmaydi. Avval o'chirish belgisini bekor qiling");

    const { remaining } = view(doc);
    if (quantity > remaining + EPS) throw fail(400, `Qaytariladigan son spisatdagi sondan oshib ketdi (qolgan: ${remaining})`);

    await changeStock(doc.productId, doc.warehouseId, quantity, t);
    await WriteOffReturn.create(
      { writeOffId: doc.id, date: b.date || today(), quantity, comment: String(b.comment || '').trim(), userId: req.user.id },
      { transaction: t },
    );
  });

  res.json(view(await load(req.params.id)));
};

// O'chirishga belgilash (X): tovar omborga qaytadi, hujjat ro'yxatda qoladi va zararga kirmaydi
exports.remove = async (req, res) => {
  await sequelize.transaction(async (t) => {
    const doc = await WriteOff.findByPk(req.params.id, { include, transaction: t });
    if (!doc) throw fail(404, 'Hujjat topilmadi');
    if (doc.deleted) return;
    if (doc.posted) await changeStock(doc.productId, doc.warehouseId, view(doc).remaining, t);
    await doc.update({ posted: false, deleted: true }, { transaction: t });
  });
  res.json({ ok: true });
};

// Belgini bekor qilish: spisat qayta kuchga kiradi (omborda yetarli tovar bo'lishi kerak)
exports.restore = async (req, res) => {
  await sequelize.transaction(async (t) => {
    const doc = await WriteOff.findByPk(req.params.id, { include, transaction: t });
    if (!doc) throw fail(404, 'Hujjat topilmadi');
    if (!doc.deleted) return;
    await changeStock(doc.productId, doc.warehouseId, -view(doc).remaining, t);
    await doc.update({ posted: true, deleted: false }, { transaction: t });
  });
  res.json({ ok: true });
};

// Butunlay o'chirish: spisat bekor qilinadi (tovar omborga qaytadi) va yozuv o'chadi
exports.purge = async (req, res) => {
  await sequelize.transaction(async (t) => {
    const doc = await WriteOff.findByPk(req.params.id, { include, transaction: t });
    if (!doc) throw fail(404, 'Hujjat topilmadi');
    if (doc.posted) await changeStock(doc.productId, doc.warehouseId, view(doc).remaining, t);
    await WriteOffReturn.destroy({ where: { writeOffId: doc.id }, transaction: t });
    await doc.destroy({ transaction: t });
  });
  res.json({ ok: true });
};
