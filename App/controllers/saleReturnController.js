const { Op } = require('sequelize');
const {
  sequelize,
  Sale,
  SaleItem,
  SaleReturn,
  SaleReturnItem,
  SaleReturnPayment,
  StockBalance,
  Product,
  Contractor,
  Warehouse,
  CashDesk,
  User,
} = require('../../models');
const currencies = require('../services/currencies');
const { assertNonNegative } = require('../services/cashbook');
const { today } = require('../utils/date');
const { EPS, roundQty } = require('../utils/qty');

const RETAIL_CLIENT = 'Chakana mijoz';

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v) || 0;
const round = (v) => Math.round(v * 100) / 100;

const include = [
  { model: Sale, as: 'sale', attributes: ['id', 'number', 'onCredit', 'total', 'date'] },
  { model: Contractor, as: 'client', attributes: ['id', 'name'] },
  { model: Warehouse, as: 'warehouse', attributes: ['id', 'name'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
  {
    model: SaleReturnItem,
    as: 'items',
    include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'barcode'] }],
  },
  {
    model: SaleReturnPayment,
    as: 'payments',
    include: [{ model: CashDesk, as: 'cashDesk', attributes: ['id', 'name'] }],
  },
];

const order = [['date', 'DESC'], ['id', 'DESC'], [{ model: SaleReturnItem, as: 'items' }, 'id', 'ASC']];

const load = (id) => SaleReturn.findByPk(id, { include, order });

/** Omborga qaytarish (+1) yoki qaytarishni bekor qilish (-1) */
async function changeStock(warehouseId, items, sign, t) {
  for (const item of items) {
    const [balance] = await StockBalance.findOrCreate({
      where: { productId: item.productId, warehouseId },
      defaults: { quantity: 0 },
      transaction: t,
    });
    if (Math.abs(item.quantity) < EPS) continue;
    const quantity = roundQty(balance.quantity + sign * item.quantity);
    if (quantity < -EPS) {
      const product = await Product.findByPk(item.productId, { transaction: t });
      throw fail(400, `Qoldiq yetarli emas: ${product?.name ?? item.productId}`);
    }
    await balance.update({ quantity }, { transaction: t });
  }
}

async function save(req, existing) {
  const b = req.body || {};
  if (existing && existing.deleted) throw fail(400, "O'chirilgan hujjatni o'zgartirib bo'lmaydi. Avval o'chirish belgisini bekor qiling");
  if (!b.saleId) throw fail(400, 'Sotuv hujjatini tanlang');

  // Qaytariladigan tovarlar: faqat qolgan qatorlar (qolganlari o'chirilgan = qaytmagan)
  const asked = new Map();
  for (const i of Array.isArray(b.items) ? b.items : []) {
    const quantity = num(i.quantity);
    if (quantity > 0) asked.set(Number(i.saleItemId), (asked.get(Number(i.saleItemId)) || 0) + quantity);
  }
  if (!asked.size) throw fail(400, 'Qaytariladigan tovarlarni qoldiring');

  const post = !!b.post;
  const refundLines = (Array.isArray(b.refundPayments) ? b.refundPayments : [])
    .map((p) => ({ cashDeskId: p.cashDeskId, amount: num(p.amount) }))
    .filter((p) => p.amount > 0);
  if (refundLines.some((p) => !p.cashDeskId)) throw fail(400, "To'lov uchun kassani tanlang");

  const id = await sequelize.transaction(async (t) => {
    const sale = await Sale.findByPk(b.saleId, {
      include: [
        { model: SaleItem, as: 'items' },
        { model: Contractor, as: 'client' },
      ],
      transaction: t,
    });
    if (!sale) throw fail(404, 'Sotuv topilmadi');
    if (sale.deleted) throw fail(400, `Sotuv o'chirishga belgilangan: ${sale.number}`);
    const saleItems = new Map(sale.items.map((i) => [i.id, i]));

    // Boshqa (provodka qilingan) qaytarishlarda allaqachon qaytgan sonlar
    const others = await SaleReturnItem.findAll({
      include: [
        {
          model: SaleReturn,
          where: { posted: true, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) },
          attributes: [],
        },
      ],
      attributes: ['saleItemId', 'quantity'],
      raw: true,
      transaction: t,
    });
    const returnedByOthers = new Map();
    for (const o of others) returnedByOthers.set(o.saleItemId, (returnedByOthers.get(o.saleItemId) || 0) + o.quantity);

    // Sotuvdagi ustama/chegirma narxlarga mutanosib taqsimlanadi: mijoz qancha to'lagan bo'lsa, shuncha qaytadi
    // (aks holda chegirmali sotuvni qaytarishda kassadan ortiqcha pul chiqib ketadi)
    const factor = sale.subtotal > 0.005 ? sale.total / sale.subtotal : 1;
    if ((b.date || today()) < sale.date) throw fail(400, "Qaytarish sanasi sotuv sanasidan oldin bo'lishi mumkin emas");

    const lines = [];
    for (const [saleItemId, quantity] of asked) {
      const si = saleItems.get(saleItemId);
      if (!si) throw fail(400, 'Tovar bu sotuvga tegishli emas');
      const available = si.quantity - (returnedByOthers.get(si.id) || 0);
      if (quantity > available + 0.0001) {
        const product = await Product.findByPk(si.productId, { transaction: t });
        throw fail(400, `Qaytarish soni sotilgan sondan oshib ketdi: ${product?.name}`);
      }
      const price = si.price * factor;
      lines.push({ saleItemId: si.id, productId: si.productId, quantity: roundQty(quantity), price: Math.round(price * 1e4) / 1e4, sum: round(quantity * price) });
    }

    const total = round(lines.reduce((s, l) => s + l.sum, 0));
    const refund = round(refundLines.reduce((s, p) => s + p.amount, 0));
    if (refund > total + 0.005) throw fail(400, "Qaytariladigan pul jami summadan oshib ketdi");

    // Oddiy (kontragentsiz) mijozga qarz yoki hisob yozib bo'lmaydi: pul to'liq qaytarilishi shart
    const named = !!sale.client && sale.client.name !== RETAIL_CLIENT;
    if (post && !named && refund < total - 0.005) {
      throw fail(400, "Oddiy mijozga qaytarishda pul to'liq qaytarilishi kerak");
    }

    if (refundLines.length) {
      const known = await CashDesk.count({ where: { id: refundLines.map((p) => p.cashDeskId) }, transaction: t });
      if (known !== new Set(refundLines.map((p) => p.cashDeskId)).size) throw fail(400, "To'lov uchun kassani tanlang");
    }

    const warehouseId = b.warehouseId || sale.warehouseId;
    const oldPairs = [];
    // Qoldiqqa sof o'zgarish: tahrirlashda eski va yangi ta'sirning farqi (oraliqda manfiy bo'lib qolmasin)
    const delta = new Map();
    const addEffect = (wh, items, sign) => {
      for (const i of items) {
        const key = `${i.productId}:${wh}`;
        delta.set(key, (delta.get(key) || 0) + sign * i.quantity);
      }
    };

    // Mavjud provodka qilingan hujjatni tahrirlash: eski ta'sir farqqa qo'shiladi
    if (existing) {
      if (existing.posted) {
        const old = await SaleReturnItem.findAll({ where: { saleReturnId: existing.id }, transaction: t });
        addEffect(existing.warehouseId, old, -1);
        const pays = await SaleReturnPayment.findAll({ where: { saleReturnId: existing.id }, transaction: t });
        pays.forEach((p) => oldPairs.push({ deskId: p.cashDeskId, currency: p.currency }));
      }
      await SaleReturnItem.destroy({ where: { saleReturnId: existing.id }, transaction: t });
      await SaleReturnPayment.destroy({ where: { saleReturnId: existing.id }, transaction: t });
    }

    const data = {
      date: b.date || today(),
      saleId: sale.id,
      clientId: sale.clientId,
      warehouseId,
      currency: sale.currency,
      rate: sale.rate || (await currencies.rateOf(sale.currency)),
      total,
      refund,
      onCredit: sale.onCredit,
      comment: b.comment || '',
      posted: post,
    };

    let doc = existing;
    if (doc) {
      await doc.update({ ...data, number: b.number || doc.number }, { transaction: t });
    } else {
      doc = await SaleReturn.create({ ...data, number: b.number || '', userId: req.user.id }, { transaction: t });
      if (!doc.number) await doc.update({ number: `VZ-${doc.id}` }, { transaction: t });
    }

    await SaleReturnItem.bulkCreate(lines.map((l) => ({ ...l, saleReturnId: doc.id })), { transaction: t });

    if (post) addEffect(warehouseId, lines, 1);
    for (const [key, change] of delta) {
      const [productId, wh] = key.split(':').map(Number);
      await changeStock(wh, [{ productId, quantity: change }], 1, t);
    }

    if (post) {
      if (refundLines.length) {
        await SaleReturnPayment.bulkCreate(
          refundLines.map((p) => ({ ...p, currency: sale.currency, saleReturnId: doc.id })),
          { transaction: t },
        );
      }
    }

    await assertNonNegative(
      [...oldPairs, ...refundLines.map((p) => ({ deskId: p.cashDeskId, currency: sale.currency }))],
      t,
    );
    return doc.id;
  });

  return load(id);
}

exports.get = async (req, res) => {
  const doc = await load(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(doc);
};

// Jurnal: ?from=YYYY-MM-DD&to=YYYY-MM-DD&clientId=
exports.list = async (req, res) => {
  const { from, to, clientId } = req.query;
  const where = {};
  if (from && to) where.date = { [Op.between]: [from, to] };
  else if (from) where.date = { [Op.gte]: from };
  else if (to) where.date = { [Op.lte]: to };
  if (clientId) where.clientId = Number(clientId);

  res.json(await SaleReturn.findAll({ where, include, order }));
};

exports.create = async (req, res) => {
  res.status(201).json(await save(req, null));
};

exports.update = async (req, res) => {
  const doc = await SaleReturn.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(await save(req, doc));
};

// O'chirishga belgilash (X): omborga qaytgan tovar va qaytarilgan pul bekor bo'ladi, hujjat ro'yxatda qoladi
exports.remove = async (req, res) => {
  const doc = await SaleReturn.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  if (doc.deleted) return res.json({ ok: true });

  await sequelize.transaction(async (t) => {
    if (doc.posted) {
      const items = await SaleReturnItem.findAll({ where: { saleReturnId: doc.id }, transaction: t });
      await changeStock(doc.warehouseId, items, -1, t);
    }
    await SaleReturnPayment.destroy({ where: { saleReturnId: doc.id }, transaction: t });
    await doc.update({ posted: false, deleted: true }, { transaction: t });
  });
  res.json({ ok: true });
};

exports.restore = async (req, res) => {
  const doc = await SaleReturn.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  await doc.update({ deleted: false });
  res.json({ ok: true });
};

// Butunlay o'chirish
exports.purge = async (req, res) => {
  const doc = await SaleReturn.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });

  await sequelize.transaction(async (t) => {
    if (doc.posted) {
      const items = await SaleReturnItem.findAll({ where: { saleReturnId: doc.id }, transaction: t });
      await changeStock(doc.warehouseId, items, -1, t);
    }
    await SaleReturnItem.destroy({ where: { saleReturnId: doc.id }, transaction: t });
    await SaleReturnPayment.destroy({ where: { saleReturnId: doc.id }, transaction: t });
    await doc.destroy({ transaction: t });
  });
  res.json({ ok: true });
};
