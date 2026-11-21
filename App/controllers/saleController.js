const { Op } = require('sequelize');
const {
  sequelize,
  Sale,
  SaleItem,
  SalePayment,
  Product,
  StockBalance,
  Contractor,
  Warehouse,
  User,
  CashDesk,
  SaleReturn,
} = require('../../models');
const { has } = require('../../config/permissions');
const cashbook = require('../services/cashbook');
const { computeStatuses } = require('../services/baskets');
const returnsService = require('../services/returns');
const { today } = require('../utils/date');
const { EPS, roundQty } = require('../utils/qty');
const ledger = require('../services/ledger');
const ordersService = require('../services/orders');
const telegram = require('../services/telegram');

const RETAIL_CLIENT = 'Chakana mijoz';

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v) || 0;
const round = (v) => Math.round(v * 100) / 100;

const include = [
  { model: Contractor, as: 'client', attributes: ['id', 'name', 'inn', 'phones'] },
  { model: Warehouse, as: 'warehouse', attributes: ['id', 'name'] },
  { model: User, as: 'cashier', attributes: ['id', 'name'] },
];

const withDetails = [
  ...include,
  {
    model: SaleItem,
    as: 'items',
    include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'barcode', 'unit'] }],
  },
  {
    model: SalePayment,
    as: 'payments',
    include: [{ model: CashDesk, as: 'cashDesk', attributes: ['id', 'name'] }],
  },
];

const order = [['date', 'DESC'], ['id', 'DESC'], [{ model: SaleItem, as: 'items' }, 'id', 'ASC']];

// Savatdagi sotuvlarga to'langan / qarz / holat qo'shiladi (to'liq to'langan sotuvlar uchun qarz 0).
// Barcha sotuvlarga qaytarilgan tovarlar (returnedQty / returnedTotal) va kontragent bor-yo'qligi (namedClient) qo'shiladi.
function annotate(sale, statuses, returns) {
  const s = sale.toJSON();
  const base = {
    ...s,
    namedClient: !!s.client && s.client.name !== RETAIL_CLIENT,
    returnedTotal: returns.bySale.get(s.id) || 0,
    items: (s.items || []).map((i) => ({ ...i, returnedQty: returns.byItem.get(i.id) || 0 })),
  };
  // O'chirishga belgilangan sotuv hisobda yo'q: qarzi ham yo'q
  if (s.deleted) return { ...base, paid: s.onCredit ? s.paidAmount : s.total, debt: 0, status: 'deleted' };
  if (s.onCredit) {
    const st = statuses.get(s.id) || { paid: s.paidAmount, debt: round(s.total - s.paidAmount), status: 'unpaid' };
    return { ...base, ...st };
  }
  return { ...base, paid: s.total, debt: 0, status: 'paid' };
}

// Oyna ochilganda standart qiymatlar: "Chakana mijoz"
exports.defaults = async (req, res) => {
  const client = await Contractor.findOne({ where: { name: RETAIL_CLIENT }, attributes: ['id', 'name', 'inn'] });
  res.json({ client });
};

/**
 * Jurnal: ?from=YYYY-MM-DD&to=YYYY-MM-DD&clientId=&kind=paid|basket&status=unpaid|paid
 *  kind=paid   - sotuv vaqtida to'langan sotuvlar ("Sotuvlar")
 *  kind=basket - to'lanmagan/qisman to'langan sotuvlar ("Savat"); status bo'yicha ham filtrlanadi
 * Har bir sotuv tovarlari va to'lovlari bilan qaytadi.
 */
exports.list = async (req, res) => {
  const { from, to, clientId, kind, status } = req.query;
  const where = {};
  if (from && to) where.date = { [Op.between]: [from, to] };
  else if (from) where.date = { [Op.gte]: from };
  else if (to) where.date = { [Op.lte]: to };
  if (clientId) where.clientId = Number(clientId);
  if (kind === 'paid') where.onCredit = false;
  if (kind === 'basket') where.onCredit = true;

  const [sales, statuses, returns] = await Promise.all([
    Sale.findAll({ where, include: withDetails, order }),
    computeStatuses(),
    returnsService.summary(),
  ]);

  let rows = sales.map((s) => annotate(s, statuses, returns));
  if (status === 'paid') rows = rows.filter((r) => r.status === 'paid');
  if (status === 'unpaid') rows = rows.filter((r) => r.status === 'unpaid' || r.status === 'partial');
  res.json(rows);
};

/** Sotuv to'liq ma'lumoti (chek chop etish uchun ham ishlatiladi) */
exports.loadDoc = async (id) => {
  const sale = await Sale.findByPk(id, { include: withDetails, order });
  return sale ? annotate(sale, await computeStatuses(), await returnsService.summary()) : null;
};

// Bitta sotuv (qaytarish hujjatida tanlash uchun)
exports.get = async (req, res) => {
  const sale = await Sale.findByPk(req.params.id, { include: withDetails, order });
  if (!sale) return res.status(404).json({ message: 'Sotuv topilmadi' });
  res.json(annotate(sale, await computeStatuses(), await returnsService.summary()));
};

exports.create = async (req, res) => {
  const b = req.body || {};
  if (!b.warehouseId) throw fail(400, 'Omborni tanlang');

  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({
    productId: i.productId,
    quantity: num(i.quantity),
    price: num(i.price),
  }));
  if (!items.length) throw fail(400, "Tovar qo'shing");
  if (items.some((i) => !i.productId || i.quantity <= 0)) throw fail(400, "Soni 0 dan katta bo'lishi kerak");
  if (items.some((i) => i.price < 0)) throw fail(400, "Narx manfiy bo'lishi mumkin emas");

  // To'lovlar (naqd/karta...): [{ cashDeskId, amount }]. Berilmasa: oddiy mijozga to'langan, kontragentga to'lovsiz (savat).
  const paymentsGiven = Array.isArray(b.payments);
  const payments = (paymentsGiven ? b.payments : [])
    .map((p) => ({ cashDeskId: p.cashDeskId, amount: num(p.amount) }))
    .filter((p) => p.amount !== 0);
  if (payments.some((p) => p.amount < 0)) throw fail(400, "To'lov summasi manfiy bo'lishi mumkin emas");
  if (payments.some((p) => !p.cashDeskId)) throw fail(400, "To'lov uchun kassani tanlang");

  // Qora ro'yxatdagi (yomon yoki juda katta qarzli) mijozga tovar sotilmaydi
  if (b.clientId) {
    const buyer = await Contractor.findByPk(b.clientId);
    if (buyer && buyer.deleted) throw fail(400, `Mijoz o'chirilgan: ${buyer.name}`);
    if (buyer && buyer.blacklisted) {
      throw fail(400, `Qora ro'yxatdagi mijozga tovar sotib bo'lmaydi: ${buyer.name}`);
    }
  }

  // Qarz muddati (faqat savat uchun): YYYY-MM-DD, bugundan oldin bo'lishi mumkin emas
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate || '')) ? String(b.dueDate) : null;
  if (dueDate && dueDate < today()) throw fail(400, "Qarz muddati bugundan oldin bo'lishi mumkin emas");

  let soldOrder = null;
  const id = await sequelize.transaction(async (t) => {
    const products = await Product.findAll({ where: { id: items.map((i) => i.productId) }, transaction: t });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Bir tovar bir necha qatorda bo'lsa, qoldiq jami son bo'yicha tekshiriladi
    const need = new Map();
    for (const i of items) {
      if (!byId.has(i.productId)) throw fail(400, 'Tovar topilmadi');
      if (byId.get(i.productId).deleted) throw fail(400, `Tovar o'chirilgan: ${byId.get(i.productId).name}`);
      // Chegara: diller narxidan arzon sotish mumkin emas (yuqori narxda sotish mumkin)
      const product = byId.get(i.productId);
      if (i.price < product.wholesalePrice - 0.005) {
        throw fail(400, `Diller narxidan arzon sotish mumkin emas: ${product.name} (diller narxi: ${product.wholesalePrice})`);
      }
      need.set(i.productId, (need.get(i.productId) || 0) + i.quantity);
    }

    for (const [productId, quantity] of need) {
      const balance = await StockBalance.findOne({ where: { productId, warehouseId: b.warehouseId }, transaction: t });
      if (!balance || balance.quantity < quantity - EPS) {
        throw fail(400, `Qoldiq yetarli emas: ${byId.get(productId).name} (bor: ${balance ? roundQty(balance.quantity) : 0})`);
      }
      await balance.update({ quantity: roundQty(balance.quantity - quantity) }, { transaction: t });
    }

    const lines = items.map((i) => ({
      ...i,
      costPrice: byId.get(i.productId).purchasePrice,
      sum: round(i.quantity * i.price),
    }));

    const subtotal = round(lines.reduce((s, l) => s + l.sum, 0));
    const markupType = b.markupType === 'percent' ? 'percent' : 'sum';
    const markupValue = num(b.markupValue);
    const markup = round(markupType === 'percent' ? (subtotal * markupValue) / 100 : markupValue);
    const total = round(Math.max(subtotal + markup, 0));

    // Chegirma (manfiy ustama) ham jami summani diller narxidan pastga tushira olmaydi
    const minTotal = lines.reduce((sum, l) => sum + l.quantity * byId.get(l.productId).wholesalePrice, 0);
    if (total < minTotal - 0.005) {
      throw fail(400, `Ustama/chegirma bilan jami summa diller narxidan past bo'lishi mumkin emas (minimum: ${minTotal})`);
    }

    const client = b.clientId ? await Contractor.findByPk(b.clientId, { transaction: t }) : null;
    const namedClient = !!client && client.name !== RETAIL_CLIENT;

    // To'lov: to'liq to'langan -> "Sotuvlar"; to'lanmagan yoki qisman -> "Savat" (qarzga, mijoz kontragent bo'lishi shart)
    // To'langan summa faqat haqiqiy to'lov qatorlaridan (kassaga tushadigan pul) hisoblanadi.
    // Ilgari to'lovlar berilmasa oddiy mijozga "to'langan" deb yozilardi, lekin kassaga pul tushmasdi.
    if (!paymentsGiven && !namedClient) throw fail(400, "To'lov uchun kassani tanlang");
    const paid = round(payments.reduce((s, p) => s + p.amount, 0));
    if (paid > total + 0.005) throw fail(400, "To'lov summasi jami summadan oshib ketdi");
    const isBasket = paid < total - 0.005;
    if (isBasket && !namedClient) {
      throw fail(400, "Qarzga sotish (savat) uchun mijozni (kontragentni) tanlang");
    }

    // Qarz limiti (kontragent kartochkasidagi "Qarzga sotish (limit)"; 0 = cheklanmagan)
    if (isBasket && client.creditLimit > 0.005) {
      const balance = await ledger.contractorBalance(client.id, b.currency || 'UZS');
      const debtAfter = round(Math.max(-balance, 0) + (total - paid));
      if (debtAfter > client.creditLimit + 0.005) {
        throw fail(400, `Qarz limiti oshib ketdi: ${client.name} (limit: ${client.creditLimit}, qarz bo'ladi: ${debtAfter})`);
      }
    }

    if (payments.length) {
      const known = await CashDesk.count({ where: { id: payments.map((p) => p.cashDeskId) }, transaction: t });
      if (known !== new Set(payments.map((p) => p.cashDeskId)).size) throw fail(400, "To'lov uchun kassani tanlang");
    }

    const currency = b.currency || 'UZS';
    const sale = await Sale.create(
      {
        onCredit: isBasket,
        paidAmount: isBasket ? paid : total,
        dueDate: isBasket ? dueDate : null,
        date: today(),
        currency,
        priceType: b.priceType === 'wholesale' ? 'wholesale' : 'retail',
        markupType,
        markupValue,
        markup,
        subtotal,
        total,
        costTotal: round(lines.reduce((s, l) => s + l.quantity * l.costPrice, 0)),
        clientId: b.clientId || null,
        warehouseId: b.warehouseId,
        cashierId: req.user.id,
      },
      { transaction: t },
    );
    await sale.update({ number: `${isBasket ? 'SV' : 'S'}-${sale.id}` }, { transaction: t });
    await SaleItem.bulkCreate(lines.map((l) => ({ ...l, saleId: sale.id })), { transaction: t });
    if (payments.length) {
      await SalePayment.bulkCreate(payments.map((p) => ({ ...p, currency, saleId: sale.id })), { transaction: t });
    }
    // Zakazdan olingan sotuv: zakaz "sotildi" bo'ladi (sotuv bilan bitta tranzaksiyada)
    if (b.orderId) soldOrder = await ordersService.markSold(Number(b.orderId), sale.id, t);

    return sale.id;
  });

  if (soldOrder && soldOrder.source === 'client' && soldOrder.telegramId) {
    telegram.notify('client', soldOrder.telegramId, `Zakazingiz ${soldOrder.number} rasmiylashtirildi. Xaridingiz uchun rahmat!`);
  }
  const sale = await Sale.findByPk(id, { include: withDetails });
  res.status(201).json(annotate(sale, await computeStatuses(), await returnsService.summary()));
};

/* ---------------- Qarz muddati va o'chirish ---------------- */

// Ruxsat sotuv turiga qarab: to'langan sotuv - "Sotuvlar" bo'limi, savat - "Savat" bo'limi
const sectionOf = (sale) => (sale.onCredit ? 'basket' : 'sales-journal');
const assertCan = (req, sale, action) => {
  if (!has(req.user && req.user.permissions, sectionOf(sale), action)) throw fail(403, "Bu amal uchun ruxsat yo'q");
};

/** Sotuv tovarlarini omborga qaytaradi (direction = +1) yoki qayta ayiradi (-1) */
async function moveStock(sale, items, direction, t) {
  const need = new Map();
  for (const i of items) need.set(i.productId, (need.get(i.productId) || 0) + i.quantity);
  for (const [productId, quantity] of need) {
    let balance = await StockBalance.findOne({ where: { productId, warehouseId: sale.warehouseId }, transaction: t });
    if (!balance) balance = await StockBalance.create({ productId, warehouseId: sale.warehouseId, quantity: 0 }, { transaction: t });
    const next = roundQty(balance.quantity + direction * quantity);
    if (next < -EPS) {
      const product = await Product.findByPk(productId, { transaction: t });
      throw fail(400, `Qoldiq yetarli emas: ${product ? product.name : productId} (bor: ${roundQty(balance.quantity)})`);
    }
    await balance.update({ quantity: next }, { transaction: t });
  }
}

const paymentDesks = (sale) => (sale.payments || []).map((p) => ({ deskId: p.cashDeskId, currency: p.currency }));

/**
 * Muddati kelgan yoki o'tib ketgan, hali to'lanmagan savatlar (yuqoridagi qo'ng'iroq belgisi uchun).
 * To'langanlari bu ro'yxatdan chiqadi, lekin "Savat" jurnalida qoladi.
 */
exports.due = async (req, res) => {
  const now = today();
  const [sales, statuses] = await Promise.all([
    Sale.findAll({
      where: { onCredit: true, deleted: false, dueDate: { [Op.ne]: null, [Op.lte]: now } },
      include: [{ model: Contractor, as: 'client', attributes: ['id', 'name', 'phones'] }],
      order: [['dueDate', 'ASC'], ['id', 'ASC']],
    }),
    computeStatuses(),
  ]);
  const rows = sales
    .map((s) => {
      const st = statuses.get(s.id);
      return {
        id: s.id,
        number: s.number,
        date: s.date,
        dueDate: s.dueDate,
        currency: s.currency,
        total: s.total,
        client: s.client,
        paid: st ? st.paid : s.paidAmount,
        debt: st ? st.debt : round(s.total - s.paidAmount),
        overdue: s.dueDate < now,
      };
    })
    .filter((r) => r.debt > 0.005);
  res.json(rows);
};

/** Savatdagi sotuvning qarz muddatini o'zgartirish (bo'sh = muddatsiz) */
exports.setDueDate = async (req, res) => {
  const sale = await Sale.findByPk(req.params.id);
  if (!sale) throw fail(404, 'Sotuv topilmadi');
  if (!sale.onCredit) throw fail(400, 'Muddat faqat qarzga sotuvga (savatga) belgilanadi');
  if (sale.deleted) throw fail(400, `Sotuv o'chirishga belgilangan: ${sale.number}`);
  const value = req.body && req.body.dueDate ? String(req.body.dueDate) : null;
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(400, "Sana noto'g'ri");
  await sale.update({ dueDate: value });
  res.json({ ok: true, dueDate: value });
};

/**
 * O'chirishga belgilash (X): tovar omborga qaytadi; to'lovi kassada, qarzi hisob-kitob va hisobotlarda hisoblanmaydi.
 * Shu sotuv bo'yicha qaytarish bo'lsa, avval qaytarishni o'chirish kerak.
 */
exports.remove = async (req, res) => {
  const sale = await Sale.findByPk(req.params.id, { include: withDetails });
  if (!sale) throw fail(404, 'Sotuv topilmadi');
  assertCan(req, sale, 'delete');
  if (sale.deleted) return res.json({ ok: true });
  if (await SaleReturn.count({ where: { saleId: sale.id, posted: true } })) {
    throw fail(400, `Bu sotuv bo'yicha qaytarish bor. Avval qaytarish hujjatini o'chiring: ${sale.number}`);
  }

  await sequelize.transaction(async (t) => {
    await moveStock(sale, sale.items, +1, t);
    await sale.update({ deleted: true }, { transaction: t });
    // To'lov kassadan chiqib ketadi: pul allaqachon sarflangan bo'lsa kassa manfiyga tushmasin
    await cashbook.assertNonNegative(paymentDesks(sale), t);
  });
  res.json({ ok: true });
};

/** Belgini bekor qilish: tovar ombordan qayta ayriladi (qoldiq yetarli bo'lishi kerak) */
exports.restore = async (req, res) => {
  const sale = await Sale.findByPk(req.params.id, { include: withDetails });
  if (!sale) throw fail(404, 'Sotuv topilmadi');
  assertCan(req, sale, 'delete');
  if (!sale.deleted) return res.json({ ok: true });

  await sequelize.transaction(async (t) => {
    await moveStock(sale, sale.items, -1, t);
    await sale.update({ deleted: false }, { transaction: t });
  });
  res.json({ ok: true });
};

/** Bazadan butunlay o'chirish (alohida ruxsat). Qaytarish hujjati bog'langan bo'lsa mumkin emas. */
exports.purge = async (req, res) => {
  const sale = await Sale.findByPk(req.params.id, { include: withDetails });
  if (!sale) throw fail(404, 'Sotuv topilmadi');
  assertCan(req, sale, 'purge');
  if (await SaleReturn.count({ where: { saleId: sale.id } })) {
    throw fail(400, `Bu sotuvga qaytarish hujjati bog'langan. Avval qaytarishni butunlay o'chiring: ${sale.number}`);
  }

  await sequelize.transaction(async (t) => {
    if (!sale.deleted) await moveStock(sale, sale.items, +1, t);
    await SalePayment.destroy({ where: { saleId: sale.id }, transaction: t });
    await SaleItem.destroy({ where: { saleId: sale.id }, transaction: t });
    await sale.destroy({ transaction: t });
    if (!sale.deleted) await cashbook.assertNonNegative(paymentDesks(sale), t);
  });
  res.json({ ok: true });
};
