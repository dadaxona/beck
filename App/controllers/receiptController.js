const {
  sequelize,
  Receipt,
  ReceiptItem,
  Product,
  StockBalance,
  Contractor,
  Warehouse,
  User,
  CashDesk,
  CashDocument,
} = require('../../models');
const currencies = require('../services/currencies');
const { assertNonNegative } = require('../services/cashbook');
const { today } = require('../utils/date');
const { EPS, roundQty, roundMoney } = require('../utils/qty');

const TYPES = { receipt: 1, return: -1, service: 0 }; // qoldiqqa ta'siri
const PREFIX = { receipt: 'KR', return: 'QR', service: 'XK' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v) || 0;
const LOCKED = "O'chirilgan hujjatni o'zgartirib bo'lmaydi. Avval o'chirish belgisini bekor qiling";

const include = [
  { model: Contractor, as: 'supplier', attributes: ['id', 'name'] },
  { model: Contractor, as: 'driver', attributes: ['id', 'name'] },
  { model: Contractor, as: 'loader', attributes: ['id', 'name'] },
  { model: Warehouse, as: 'warehouse', attributes: ['id', 'name'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
];

const withItems = [
  ...include,
  {
    model: ReceiptItem,
    as: 'items',
    include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'barcode'] }],
  },
];

/** Hujjatning qoldiqqa ta'siri: { "tovar:ombor" -> son } (sign: +1 provodka, -1 bekor qilish) */
function stockEffect(type, warehouseId, items, sign, into = new Map()) {
  const k = TYPES[type] * sign;
  if (!k) return into;
  for (const i of items) {
    const key = `${i.productId}:${warehouseId}`;
    into.set(key, (into.get(key) || 0) + k * i.quantity);
  }
  return into;
}

/**
 * Qoldiqqa sof o'zgarishni yozadi. Tahrirlashda eski va yangi ta'sirning FARQI qo'llanadi:
 * masalan 10 ta kirim qilib 8 tasi sotilgan bo'lsa, kirimni 12 ga o'zgartirish +2 bo'ladi (avval -10 emas).
 */
async function applyDelta(delta, t) {
  for (const [key, change] of delta) {
    if (Math.abs(change) < EPS) continue;
    const [productId, warehouseId] = key.split(':').map(Number);
    const [balance] = await StockBalance.findOrCreate({
      where: { productId, warehouseId },
      defaults: { quantity: 0 },
      transaction: t,
    });
    const quantity = roundQty(balance.quantity + change);
    if (quantity < -EPS) {
      const product = await Product.findByPk(productId, { transaction: t });
      throw fail(400, `Qoldiq yetarli emas: ${product?.name ?? productId} (bor: ${roundQty(balance.quantity)})`);
    }
    await balance.update({ quantity }, { transaction: t });
  }
}

/**
 * Tovar narxlari oxirgi (sana bo'yicha) provodka qilingan tovar kirimidan olinadi.
 * Kirim o'chirilsa yoki provodkasi bekor qilinsa, narxlar oldingi kirimdagiga qaytadi.
 * Boshqa kirim bo'lmasa, olish narxi o'chirilgan qatordagi "oldingi olish narxi"ga qaytariladi.
 */
/* Narxlar kirim valyutasida yoziladi va tovar valyutasi ham kirim valyutasiga o'tadi (100 USD = 100, USD) */
async function syncPrices(productIds, t, fallback = []) {
  for (const productId of new Set(productIds)) {
    const last = await ReceiptItem.findOne({
      where: { productId },
      include: [{ model: Receipt, attributes: ['currency'], where: { posted: true, type: 'receipt' }, required: true }],
      order: [
        [Receipt, 'date', 'DESC'],
        [Receipt, 'id', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: t,
    });
    if (last) {
      await Product.update(
        {
          purchasePrice: last.purchasePrice,
          wholesalePrice: last.wholesalePrice,
          retailPrice: last.retailPrice,
          currency: (last.Receipt && last.Receipt.currency) || 'UZS',
        },
        { where: { id: productId }, transaction: t },
      );
    } else {
      const prev = fallback.find((i) => i.productId === productId && i.prevPurchasePrice > 0);
      if (prev) await Product.update({ purchasePrice: prev.prevPurchasePrice }, { where: { id: productId }, transaction: t });
    }
  }
}

/**
 * Kirim bilan bog'langan kassa hujjati ("To'langan summa"): tovar kirimi/xizmat -> kassadan chiqim
 * (yetkazib beruvchiga), qaytarish -> kassaga kirim (yetkazib beruvchidan). Avvalgisi o'chirilib, kerak bo'lsa qayta yaratiladi.
 */
async function syncPayment(doc, t, userId) {
  const pairs = [];
  if (doc.cashDocumentId) {
    const old = await CashDocument.findByPk(doc.cashDocumentId, { transaction: t });
    if (old) {
      pairs.push({ deskId: old.cashDeskId, currency: old.currency });
      await old.destroy({ transaction: t });
    }
  }

  let cashDocumentId = null;
  if (doc.posted && !doc.deleted && doc.paidAmount > 0.005) {
    const type = doc.type === 'return' ? 'income' : 'expense';
    const cash = await CashDocument.create(
      {
        type,
        number: '',
        date: doc.date,
        posted: true,
        partyType: 'contractor',
        currency: doc.currency,
        accountCurrency: doc.currency,
        rate: doc.rate,
        accountRate: doc.rate,
        cashAmount: doc.paidAmount,
        accountAmount: doc.paidAmount,
        coef1: 1,
        coef2: 1,
        comment: `${doc.number} (avtomatik)`,
        cashDeskId: doc.cashDeskId,
        contractorId: doc.supplierId,
        userId,
      },
      { transaction: t },
    );
    await cash.update({ number: `${type === 'income' ? 'KK' : 'KC'}-${cash.id}` }, { transaction: t });
    cashDocumentId = cash.id;
    pairs.push({ deskId: doc.cashDeskId, currency: doc.currency });
  }
  if (cashDocumentId !== doc.cashDocumentId) await doc.update({ cashDocumentId }, { transaction: t });
  // Kassa hech qachon manfiy bo'lmasin (pul yetmasa to'lov yozilmaydi)
  await assertNonNegative(pairs, t);
}

const load = (id) => Receipt.findByPk(id, { include: withItems, order: [[{ model: ReceiptItem, as: 'items' }, 'id', 'ASC']] });

async function save(req, res, existing) {
  const b = req.body || {};
  const type = existing ? existing.type : b.type;

  if (existing && existing.deleted) throw fail(400, LOCKED);
  if (!(type in TYPES)) throw fail(400, 'Hujjat turi noto\'g\'ri');
  if (!b.warehouseId) throw fail(400, 'Omborni tanlang');

  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({
    productId: i.productId,
    quantity: roundQty(num(i.quantity)),
    purchasePrice: num(i.purchasePrice),
    prevPurchasePrice: num(i.prevPurchasePrice),
    wholesalePrice: num(i.wholesalePrice),
    retailPrice: num(i.retailPrice),
  }));

  if (b.post && !items.length) throw fail(400, 'Tovar qo\'shing');
  if (items.some((i) => !i.productId)) throw fail(400, 'Barcha qatorlarda tovar tanlanishi kerak');
  if (items.some((i) => i.quantity <= 0)) throw fail(400, 'Soni 0 dan katta bo\'lishi kerak');
  if (items.some((i) => i.purchasePrice < 0 || i.wholesalePrice < 0 || i.retailPrice < 0)) {
    throw fail(400, "Narx manfiy bo'lishi mumkin emas");
  }
  items.forEach((i) => (i.sum = roundMoney(i.quantity * i.purchasePrice)));
  const total = roundMoney(items.reduce((s, i) => s + i.sum, 0));

  // O'chirishga belgilangan tovar bilan yangi hujjat yozib bo'lmaydi
  const goneProduct = items.length
    ? await Product.findOne({ where: { id: items.map((i) => i.productId), deleted: true }, attributes: ['name'] })
    : null;
  if (goneProduct) throw fail(400, `Tovar o'chirilgan: ${goneProduct.name}`);

  // To'langan summa: kassadan haqiqatan to'lanadi (bog'langan kassa hujjati)
  const paidAmount = roundMoney(num(b.paidAmount));
  const cashDeskId = b.cashDeskId ? Number(b.cashDeskId) : null;
  if (paidAmount < 0) throw fail(400, "To'lov summasi manfiy bo'lishi mumkin emas");
  if (paidAmount > 0.005) {
    if (!cashDeskId || !(await CashDesk.findByPk(cashDeskId))) throw fail(400, "To'lov uchun kassani tanlang");
    if (!b.supplierId) throw fail(400, 'Kontragentni tanlang');
    if (paidAmount > total + 0.005) throw fail(400, "To'lov summasi jami summadan oshib ketdi");
  }

  // Qo'shimcha xarajatlar: Avto bo'lsa jami = transport + yuklash + saqlash
  const extra = {
    transportCost: num(b.transportCost),
    loadingCost: num(b.loadingCost),
    storageCost: num(b.storageCost),
    extraAuto: b.extraAuto !== false,
    coef1: num(b.coef1) || 1,
    coef2: num(b.coef2) || 1,
  };
  extra.extraTotal = roundMoney(
    extra.extraAuto ? extra.transportCost + extra.loadingCost + extra.storageCost : num(b.extraTotal),
  );
  if ([extra.transportCost, extra.loadingCost, extra.storageCost, extra.extraTotal].some((v) => v < 0)) {
    throw fail(400, "Summa manfiy bo'lishi mumkin emas");
  }

  // Valyuta va o'sha paytdagi kurs (tahrirlashda valyuta o'zgarmasa eski kurs qoladi)
  const currency = b.currency || 'UZS';
  const currentRate = await currencies.assertKnown(currency);
  const rate = existing && existing.currency === currency && existing.rate ? existing.rate : currentRate;

  const id = await sequelize.transaction(async (t) => {
    let doc = existing;
    const delta = new Map();
    let oldItems = [];

    if (doc) {
      oldItems = await ReceiptItem.findAll({ where: { receiptId: doc.id }, raw: true, transaction: t });
      if (doc.posted) stockEffect(doc.type, doc.warehouseId, oldItems, -1, delta);
      await ReceiptItem.destroy({ where: { receiptId: doc.id }, transaction: t });
    }

    const data = {
      date: b.date || today(),
      supplierId: b.supplierId || null,
      driverId: b.driverId || null,
      loaderId: b.loaderId || null,
      paymentType: b.paymentType || '',
      paidAmount,
      cashDeskId,
      checkExpiry: !!b.checkExpiry,
      ...extra,
      warehouseId: b.warehouseId,
      currency,
      rate,
      note: b.note || '',
      total,
      posted: !!b.post,
    };

    if (doc) {
      await doc.update({ ...data, number: b.number || doc.number }, { transaction: t });
    } else {
      doc = await Receipt.create({ ...data, type, number: b.number || '', userId: req.user.id }, { transaction: t });
      if (!doc.number) await doc.update({ number: `${PREFIX[type]}-${doc.id}` }, { transaction: t });
    }

    await ReceiptItem.bulkCreate(items.map((i) => ({ ...i, receiptId: doc.id })), { transaction: t });

    if (data.posted) stockEffect(type, data.warehouseId, items, 1, delta);
    await applyDelta(delta, t);

    // Tovar kirimida narxlar oxirgi kirimdan olinadi (eski qatorlardagi tovarlar ham qayta hisoblanadi)
    if (type === 'receipt') {
      await syncPrices([...oldItems, ...items].map((i) => i.productId), t, oldItems);
    }
    await syncPayment(doc, t, req.user.id);

    return doc.id;
  });

  return load(id);
}

exports.list = async (req, res) => {
  res.json(await Receipt.findAll({ include, order: [['date', 'DESC'], ['id', 'DESC']] }));
};

exports.get = async (req, res) => {
  const doc = await load(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(doc);
};

exports.create = async (req, res) => {
  res.status(201).json(await save(req, res, null));
};

exports.update = async (req, res) => {
  const doc = await Receipt.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(await save(req, res, doc));
};

/** Provodkani bekor qiladi: qoldiq, narxlar va bog'langan kassa to'lovi qaytadi */
async function unpost(doc, t, userId) {
  const items = await ReceiptItem.findAll({ where: { receiptId: doc.id }, raw: true, transaction: t });
  if (doc.posted) await applyDelta(stockEffect(doc.type, doc.warehouseId, items, -1), t);
  await doc.update({ posted: false }, { transaction: t });
  if (doc.type === 'receipt') await syncPrices(items.map((i) => i.productId), t, items);
  await syncPayment(doc, t, userId);
  return items;
}

// O'chirishga belgilash (X): provodka bekor qilinadi (qoldiq, qarz, narx va kassa to'lovi qaytadi), hujjat ro'yxatda qoladi
exports.remove = async (req, res) => {
  const doc = await Receipt.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  if (doc.deleted) return res.json({ ok: true });

  await sequelize.transaction(async (t) => {
    await doc.update({ deleted: true }, { transaction: t });
    await unpost(doc, t, req.user.id);
  });
  res.json({ ok: true });
};

// O'chirish belgisini bekor qilish (hujjat provodkasiz qoladi: kerak bo'lsa qayta provodka qilinadi)
exports.restore = async (req, res) => {
  const doc = await Receipt.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  await doc.update({ deleted: false });
  res.json({ ok: true });
};

// Butunlay o'chirish
exports.purge = async (req, res) => {
  const doc = await Receipt.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });

  await sequelize.transaction(async (t) => {
    await doc.update({ deleted: true }, { transaction: t }); // bog'langan to'lov qayta yaratilmasin
    await unpost(doc, t, req.user.id);
    await ReceiptItem.destroy({ where: { receiptId: doc.id }, transaction: t });
    await doc.destroy({ transaction: t });
  });

  res.json({ ok: true });
};
