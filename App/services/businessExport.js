'use strict';

/**
 * "To'liq biznes tahlili" (AI yordamchi) uchun eksport: tanlangan davr bo'yicha barcha bo'limlar ma'lumoti
 * mavzular bo'yicha 7 ta faylga (har birida bir nechta bo'lim/jadval) yig'iladi.
 *
 * Aniqlik: moliyaviy natija "Moliya hisoboti" bilan aynan bir xil hisob-kitobdan olinadi (finance.js),
 * qarzlar - hisob-kitob kitobidan (ledger.js). Barcha summalar tanlangan valyutada: hujjatlar o'z kursi bo'yicha,
 * tovar narxlari / qoldiqlar hozirgi kurs bo'yicha o'giriladi. AI hech narsani noldan hisoblamasligi uchun
 * jami va ulushlar shu yerda hisoblanadi.
 *
 * Shaxsiy ma'lumotlar (telefon, manzil, INN, parollar) yuborilmaydi - tahlil uchun kerak emas.
 */
const { Op } = require('sequelize');
const {
  Sale, SaleItem, SaleReturn, SaleReturnItem, Receipt, ReceiptItem, CashDocument, CashDesk, CashArticle, StockBalance,
  Product, ProductCategory, Contractor, Category, Warehouse, StockTransfer, StockTransferItem, WriteOff, WriteOffReturn,
  Payroll, PayrollItem, User, Role,
} = require('../../models');
const finance = require('./finance');
const ledger = require('./ledger');
const baskets = require('./baskets');
const returnsService = require('./returns');
const cashbook = require('./cashbook');
const currencies = require('./currencies');
const { employeeIds } = require('./employees');
const { today } = require('../utils/date');

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (part, whole) => (Math.abs(whole) > 0.005 ? r2((part / whole) * 100) : '');
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const WEEK = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const timeOf = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : `${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
const byDesc = (key) => (a, b) => b[key] - a[key];

/** Davr sharti (sana ustuni bo'yicha, ikkala chegara ham kiradi) */
const inPeriod = (from, to) => ({ [Op.gte]: from || '1900-01-01', [Op.lte]: to || '2999-12-31' });

/** Davrdagi oylar ro'yxati (ko'pi bilan 36 oy) */
function monthsOf(from, to) {
  const out = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let y = fy;
  let m = fm;
  while ((y < ty || (y === ty && m <= tm)) && out.length < 36) {
    const first = `${y}-${pad(m)}-01`;
    const last = isoOf(new Date(y, m, 0));
    out.push({ month: `${y}-${pad(m)}`, from: first < from ? from : first, to: last > to ? to : last });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Nom bo'yicha lug'at: id -> name */
const names = async (Model, ids, attr = 'name') => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await Model.findAll({ where: { id: list }, attributes: ['id', attr], raw: true })).map((r) => [r.id, r[attr]]));
};

async function buildExport({ currency = 'UZS', from = null, to = null } = {}) {
  const now = today();
  const conv = await currencies.converter();
  const money = (amount, row) => r2(conv(amount, row.currency, row.rate, currency)); // hujjat kursi bo'yicha
  const priceNow = (amount, cur) => conv(amount, cur, null, currency); // hozirgi kurs bo'yicha

  // ---- Davr: berilmagan bo'lsa - birinchi sotuvdan bugungacha
  const firstSale = await Sale.min('date', { where: { deleted: false } });
  const pFrom = from || (firstSale ? String(firstSale).slice(0, 10) : now);
  const pTo = to && to < now ? to : now;
  const periodDays = Math.max(1, daysBetween(pFrom, pTo) + 1);
  const range = inPeriod(pFrom, pTo);

  // ================================================================ asosiy yuklash
  const [report, data, balances, staff, returnsSum, basketStatus, products, categories, stockRows, warehouses] = await Promise.all([
    finance.financeReport(currency, pFrom, pTo),
    finance.loadData(currency),
    ledger.balancesByContractor(currency, pTo),
    employeeIds(),
    returnsService.summary(),
    baskets.computeStatuses(),
    Product.findAll({ attributes: ['id', 'name', 'categoryId', 'purchasePrice', 'wholesalePrice', 'retailPrice', 'currency', 'unit', 'deleted'], raw: true }),
    ProductCategory.findAll({ attributes: ['id', 'name'], raw: true }),
    StockBalance.findAll({ attributes: ['productId', 'warehouseId', 'quantity'], raw: true }),
    Warehouse.findAll({ attributes: ['id', 'name'], raw: true }),
  ]);
  const productOf = new Map(products.map((p) => [p.id, p]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const pName = (id) => productOf.get(id)?.name || `#${id}`;
  const pCat = (id) => catName.get(productOf.get(id)?.categoryId) || '';

  // ================================================================ 1. Moliya
  const pl = report;
  const moliyaNatija = [
    ['Ko\'rsatkich', 'Summa', 'Sof tushumdagi ulushi %'],
    ['Sotuvlar soni', pl.count, ''],
    ['Yalpi tushum (sotuvlar)', pl.gross, ''],
    ['Mijozdan qaytarishlar', pl.returned, pct(pl.returned, pl.gross)],
    ['SOF TUSHUM', pl.net, 100],
    ['Tannarx (sotilgan tovar)', pl.cost, pct(pl.cost, pl.net)],
    ['YALPI FOYDA', pl.grossProfit, pct(pl.grossProfit, pl.net)],
    ['Xarajat: ish haqi', pl.expenses.payroll, pct(pl.expenses.payroll, pl.net)],
    ['Xarajat: xizmatlar (xizmat kirimi)', pl.expenses.services, pct(pl.expenses.services, pl.net)],
    ['Xarajat: kirimdagi qo\'shimcha (transport, yuklash, saqlash)', pl.expenses.receiptExtra, pct(pl.expenses.receiptExtra, pl.net)],
    ['Xarajat: hisobdan chiqarish (spisaniya, yo\'qotish)', pl.expenses.writeOff, pct(pl.expenses.writeOff, pl.net)],
    ['Xarajat: boshqa (kassadan kontragentsiz chiqim)', pl.expenses.other, pct(pl.expenses.other, pl.net)],
    ['XARAJATLAR JAMI', pl.expenses.total, pct(pl.expenses.total, pl.net)],
    ['Boshqa daromad (kassaga kontragentsiz kirim)', pl.otherIncome, pct(pl.otherIncome, pl.net)],
    ['SOF FOYDA', pl.netProfit, pct(pl.netProfit, pl.net)],
    ['Davr sotuvlarining hali to\'lanmagan qismi (qarzga)', pl.unpaid, pct(pl.unpaid, pl.net)],
    ['Sof foyda - qarzlarsiz (haqiqatda kelgan pul)', pl.cashProfit, pct(pl.cashProfit, pl.net)],
    ['Investitsiya (tashqaridan kiritilgan pul, foydaga kirmaydi)', pl.investments ?? 0, ''],
  ];
  const likvidlik = [
    ['Ko\'rsatkich', 'Summa', 'Izoh'],
    ['Kassadagi pul (barcha kassalar)', pl.cash, 'hozirgi holat'],
    ['Debitorlar - bizga qarzdorlar', pl.debts.receivable, `${pl.debts.receivableCount} ta kontragent, ${pTo} holatiga`],
    ['Kreditorlar - biz qarzdormiz', pl.debts.payable, `${pl.debts.payableCount} ta kontragent, ${pTo} holatiga`],
    ['Qarzlar saldosi (debitor - kreditor)', pl.debts.net, ''],
    ['Ombordagi tovar (kelish narxida)', pl.stock.costValue, `${pl.stock.kinds} xil tovar`],
    ['Ombordagi tovar (chakana narxda)', pl.stock.retailValue, 'potentsial tushum'],
    ['Joriy aktivlar jami (kassa + debitor + tovar kelish narxida)', r2(pl.cash + pl.debts.receivable + pl.stock.costValue), ''],
    ['Joriy likvidlik koeffitsienti (aktivlar / kreditorlar)', pl.debts.payable > 0.005 ? r2((pl.cash + pl.debts.receivable + pl.stock.costValue) / pl.debts.payable) : 'kreditor yo\'q', '1 dan kichik - xavfli'],
    ['Tezkor likvidlik (kassa + debitor) / kreditorlar', pl.debts.payable > 0.005 ? r2((pl.cash + pl.debts.receivable) / pl.debts.payable) : 'kreditor yo\'q', ''],
  ];
  const oylar = [['Oy', 'Sotuvlar soni', 'Sof tushum', 'Tannarx', 'Yalpi foyda', 'Yalpi marja %', 'Ish haqi', 'Xizmatlar', 'Kirim qo\'shimcha xarajati', 'Spisaniya', 'Boshqa xarajat', 'Xarajatlar jami', 'Boshqa daromad', 'Sof foyda', 'Sof marja %', 'Qarzga sotilgan (to\'lanmagan)']];
  for (const m of monthsOf(pFrom, pTo)) {
    const s = finance.summarize(data, m.from, m.to);
    oylar.push([m.month, s.count, s.net, s.cost, s.grossProfit, s.margin, s.expenses.payroll, s.expenses.services, s.expenses.receiptExtra, s.expenses.writeOff, s.expenses.other, s.expenses.total, s.otherIncome, s.netProfit, pct(s.netProfit, s.net), s.unpaid]);
  }
  const kassalar = [['Kassa (to\'lov turi)', 'Valyuta', 'Qoldiq', `Qoldiq (${currency}da)`]];
  const desks = await CashDesk.findAll({ attributes: ['id', 'name'], raw: true });
  for (const d of desks) {
    for (const c of await currencies.list()) {
      const b = await cashbook.deskBalance(d.id, c.code);
      if (Math.abs(b) > 0.005) kassalar.push([d.name, c.code, r2(b), r2(priceNow(b, c.code))]);
    }
  }

  // ================================================================ 2. Sotuvlar
  const sales = await Sale.findAll({
    where: { deleted: false, date: range },
    attributes: ['id', 'number', 'date', 'createdAt', 'currency', 'rate', 'total', 'costTotal', 'markup', 'clientId', 'cashierId', 'onCredit'],
    raw: true,
  });
  const saleOf = new Map(sales.map((s) => [s.id, s]));
  const items = sales.length
    ? await SaleItem.findAll({
        attributes: ['id', 'saleId', 'productId', 'quantity', 'price', 'costPrice'],
        include: [{ model: Sale, attributes: [], required: true, where: { deleted: false, date: range } }],
        raw: true,
      })
    : [];
  const clientNames = await names(Contractor, sales.map((s) => s.clientId));
  const cashierNames = await names(User, sales.map((s) => s.cashierId));

  // Tovar bo'yicha (qaytarilgani ayrilgan)
  const byProduct = new Map();
  const saleCostBack = new Map(); // sotuv -> qaytgan tovar tannarxi
  for (const i of items) {
    const s = saleOf.get(i.saleId);
    if (!s) continue;
    const back = returnsSum.byItem.get(i.id) || 0;
    const q = i.quantity - back;
    if (back) saleCostBack.set(s.id, (saleCostBack.get(s.id) || 0) + back * i.costPrice);
    const a = byProduct.get(i.productId) || { qty: 0, revenue: 0, cost: 0, docs: new Set(), back: 0, last: '' };
    a.qty += q;
    a.back += back;
    a.revenue += money(q * i.price, s);
    a.cost += money(q * i.costPrice, s);
    a.docs.add(s.id);
    if (String(s.date) > a.last) a.last = String(s.date);
    byProduct.set(i.productId, a);
  }
  const prodRows = [...byProduct.entries()].map(([id, a]) => ({ id, ...a, profit: a.revenue - a.cost })).sort(byDesc('revenue'));
  const totalRev = prodRows.reduce((t, a) => t + a.revenue, 0);
  let cum = 0;
  const tovarSotuv = [['Tovar', 'Kategoriya', 'Sotildi (soni)', 'Qaytarildi (soni)', 'Tushum', 'Tannarx', 'Foyda', 'Marja %', 'Tushumdagi ulushi %', 'ABC guruh', 'Necha sotuvda', 'Oxirgi sotuv']];
  for (const a of prodRows) {
    // ABC: tovar o'zidan oldingilarning jamg'arma ulushi 80% ga yetmagan bo'lsa - A, 95% ga yetmagan bo'lsa - B
    const before = totalRev > 0 ? cum / totalRev : 1;
    cum += a.revenue;
    tovarSotuv.push([pName(a.id), pCat(a.id), r2(a.qty), r2(a.back), r2(a.revenue), r2(a.cost), r2(a.profit), pct(a.profit, a.revenue), pct(a.revenue, totalRev), before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C', a.docs.size, a.last]);
  }

  // Sotuv hujjati bo'yicha sof summa va foyda (Moliya hisoboti bilan bir xil: summa - qaytarilgan; tannarx - qaytgan tannarx)
  const saleNet = (s) => money(s.total - (returnsSum.bySale.get(s.id) || 0), s);
  const saleProfit = (s) => saleNet(s) - money(s.costTotal - (saleCostBack.get(s.id) || 0), s);

  const byClient = new Map();
  const byCashier = new Map();
  const byWeekday = new Map();
  const byHour = new Map();
  for (const s of sales) {
    const net = saleNet(s);
    const profit = saleProfit(s);
    const c = byClient.get(s.clientId || 0) || { count: 0, revenue: 0, profit: 0, credit: 0, last: '' };
    c.count++;
    c.revenue += net;
    c.profit += profit;
    if (s.onCredit) c.credit++;
    if (String(s.date) > c.last) c.last = String(s.date);
    byClient.set(s.clientId || 0, c);
    const k = byCashier.get(s.cashierId || 0) || { count: 0, revenue: 0, profit: 0, discount: 0 };
    k.count++;
    k.revenue += net;
    k.profit += profit;
    if (s.markup < 0) k.discount += money(-s.markup, s);
    byCashier.set(s.cashierId || 0, k);
    const wd = WEEK[new Date(`${s.date}T12:00:00`).getDay()];
    const w = byWeekday.get(wd) || { count: 0, revenue: 0 };
    w.count++;
    w.revenue += net;
    byWeekday.set(wd, w);
    const h = timeOf(s.createdAt).slice(0, 2);
    if (h) {
      const x = byHour.get(h) || { count: 0, revenue: 0 };
      x.count++;
      x.revenue += net;
      byHour.set(h, x);
    }
  }
  const mijozSotuv = [['Mijoz', 'Sotuvlar soni', 'Shundan qarzga', 'Tushum', 'Foyda', 'Marja %', 'O\'rtacha chek', 'Tushumdagi ulushi %', 'Hozirgi qarzi (bizga)', 'Oxirgi xarid']];
  const clientTotal = [...byClient.values()].reduce((t, c) => t + c.revenue, 0);
  for (const [id, c] of [...byClient.entries()].sort((a, b) => b[1].revenue - a[1].revenue)) {
    mijozSotuv.push([id ? clientNames.get(id) || `#${id}` : '(mijozsiz - chakana)', c.count, c.credit, r2(c.revenue), r2(c.profit), pct(c.profit, c.revenue), r2(c.revenue / c.count), pct(c.revenue, clientTotal), id && balances[id] < -0.005 ? r2(-balances[id]) : '', c.last]);
  }
  const kassirSotuv = [['Kassir', 'Sotuvlar soni', 'Tushum', 'Foyda', 'Marja %', 'O\'rtacha chek', 'Berilgan chegirmalar']];
  for (const [id, k] of [...byCashier.entries()].sort((a, b) => b[1].revenue - a[1].revenue)) {
    kassirSotuv.push([cashierNames.get(id) || '-', k.count, r2(k.revenue), r2(k.profit), pct(k.profit, k.revenue), r2(k.revenue / k.count), r2(k.discount)]);
  }
  const haftaKunlari = [['Hafta kuni', 'Sotuvlar soni', 'Tushum', 'O\'rtacha chek']];
  for (const d of [1, 2, 3, 4, 5, 6, 0].map((i) => WEEK[i])) {
    const w = byWeekday.get(d);
    if (w) haftaKunlari.push([d, w.count, r2(w.revenue), r2(w.revenue / w.count)]);
  }
  const soatlar = [['Soat', 'Sotuvlar soni', 'Tushum']];
  for (const [h, x] of [...byHour.entries()].sort()) soatlar.push([`${h}:00`, x.count, r2(x.revenue)]);

  // Mijozdan qaytarishlar (tovar bo'yicha)
  const retDocs = await SaleReturn.findAll({ where: { posted: true, deleted: false, date: range }, attributes: ['id', 'date', 'currency', 'rate', 'total', 'refund', 'comment', 'clientId'], raw: true });
  const retOf = new Map(retDocs.map((r) => [r.id, r]));
  const retItems = retDocs.length ? await SaleReturnItem.findAll({ where: { saleReturnId: retDocs.map((r) => r.id) }, attributes: ['saleReturnId', 'productId', 'quantity', 'sum'], raw: true }) : [];
  const retByProduct = new Map();
  for (const i of retItems) {
    const r = retOf.get(i.saleReturnId);
    const a = retByProduct.get(i.productId) || { qty: 0, sum: 0, docs: 0, comments: new Set() };
    a.qty += i.quantity;
    a.sum += money(i.sum, r);
    a.docs++;
    if (r.comment) a.comments.add(String(r.comment).slice(0, 80));
    retByProduct.set(i.productId, a);
  }
  const qaytarishlar = [['Tovar', 'Qaytarildi (soni)', 'Summa', 'Necha marta', 'Shu tovar sotuvidagi qaytarish %', 'Izohlar (sabablar)']];
  for (const [id, a] of [...retByProduct.entries()].sort((x, y) => y[1].sum - x[1].sum)) {
    const sold = byProduct.get(id);
    qaytarishlar.push([pName(id), r2(a.qty), r2(a.sum), a.docs, sold ? pct(a.qty, sold.qty + sold.back) : '', [...a.comments].slice(0, 5).join(' | ')]);
  }

  // ================================================================ 3. Tovarlar va ombor
  const stockQty = new Map();
  const whAgg = new Map();
  for (const b of stockRows) {
    stockQty.set(b.productId, (stockQty.get(b.productId) || 0) + b.quantity);
    const p = productOf.get(b.productId);
    if (!p || p.deleted) continue;
    const w = whAgg.get(b.warehouseId) || { kinds: 0, qty: 0, cost: 0, retail: 0, negative: 0 };
    if (b.quantity > 0.0005) {
      w.kinds++;
      w.qty += b.quantity;
      w.cost += b.quantity * priceNow(p.purchasePrice, p.currency);
      w.retail += b.quantity * priceNow(p.retailPrice, p.currency);
    } else if (b.quantity < -0.0005) w.negative++;
    whAgg.set(b.warehouseId, w);
  }
  const tovarlar = [['Tovar', 'Kategoriya', 'Birlik', 'Qoldiq', 'Kelish narxi', 'Ulgurji narx', 'Chakana narx', 'Ustama %', 'Qoldiq qiymati (kelish)', 'Qoldiq qiymati (chakana)', 'Davrda sotildi', 'Kunlik o\'rtacha sotuv', 'Qoldiq necha kunga yetadi', 'Oxirgi sotuv', 'Holat']];
  for (const p of products.filter((x) => !x.deleted)) {
    const q = stockQty.get(p.id) || 0;
    const sold = byProduct.get(p.id);
    const perDay = sold ? sold.qty / periodDays : 0;
    const buy = priceNow(p.purchasePrice, p.currency);
    const retail = priceNow(p.retailPrice, p.currency);
    let state = '';
    if (q < -0.0005) state = 'MANFIY QOLDIQ (xato)';
    else if (retail > 0 && buy > 0 && retail <= buy) state = 'ZARAR: chakana <= kelish';
    else if (q > 0.0005 && !sold) state = 'davrda sotilmagan';
    else if (perDay > 0 && q / perDay < 7) state = 'tez tugaydi (<7 kun)';
    else if (perDay > 0 && q / perDay > 180) state = 'ortiqcha zaxira (>180 kun)';
    tovarlar.push([p.name, catName.get(p.categoryId) || '', p.unit || '', r2(q), r2(buy), r2(priceNow(p.wholesalePrice, p.currency)), r2(retail), buy > 0 ? pct(retail - buy, buy) : '', r2(q * buy), r2(q * retail), sold ? r2(sold.qty) : 0, r2(perDay), perDay > 0 ? Math.round(q / perDay) : q > 0 ? 'sotilmayapti' : '', sold?.last || '', state]);
  }
  const omborlar = [['Ombor', 'Tovar turlari', 'Jami soni', 'Qiymati (kelish)', 'Qiymati (chakana)', 'Manfiy qoldiqli tovarlar']];
  for (const [id, w] of whAgg) omborlar.push([whName.get(id) || `#${id}`, w.kinds, r2(w.qty), r2(w.cost), r2(w.retail), w.negative]);

  const transfers = await StockTransfer.findAll({
    where: { deleted: false, date: range },
    attributes: ['id', 'number', 'date', 'fromWarehouseId', 'toWarehouseId', 'comment'],
    include: [{ model: StockTransferItem, as: 'items', attributes: ['productId', 'quantity'] }],
  });
  const kochirishlar = [['Hujjat', 'Sana', 'Qayerdan', 'Qayerga', 'Tovar', 'Soni', 'Izoh']];
  for (const t of transfers) for (const i of t.items) kochirishlar.push([t.number, t.date, whName.get(t.fromWarehouseId) || '', whName.get(t.toWarehouseId) || '', pName(i.productId), r2(i.quantity), t.comment || '']);

  const writeOffs = await WriteOff.findAll({ where: { posted: true, deleted: false, date: range }, attributes: ['id', 'number', 'date', 'productId', 'warehouseId', 'quantity', 'costPrice', 'currency', 'rate', 'comment'], raw: true });
  const woBack = new Map();
  if (writeOffs.length) {
    for (const r of await WriteOffReturn.findAll({ where: { writeOffId: writeOffs.map((w) => w.id) }, attributes: ['writeOffId', 'quantity'], raw: true })) {
      woBack.set(r.writeOffId, (woBack.get(r.writeOffId) || 0) + r.quantity);
    }
  }
  const spisaniya = [['Hujjat', 'Sana', 'Tovar', 'Ombor', 'Soni', 'Qaytarildi', 'Yo\'qotish summasi', 'Izoh (sabab)']];
  for (const w of writeOffs) {
    const back = woBack.get(w.id) || 0;
    spisaniya.push([w.number, w.date, pName(w.productId), whName.get(w.warehouseId) || '', r2(w.quantity), r2(back), money(Math.max(w.quantity - back, 0) * w.costPrice, w), w.comment || '']);
  }

  // ================================================================ 4. Xaridlar (kirim) va yetkazib beruvchilar
  const receipts = await Receipt.findAll({
    where: { posted: true, deleted: false, date: range },
    attributes: ['id', 'number', 'date', 'type', 'currency', 'rate', 'total', 'paidAmount', 'transportCost', 'loadingCost', 'storageCost', 'extraTotal', 'supplierId', 'warehouseId'],
    raw: true,
  });
  const supplierNames = await names(Contractor, receipts.map((r) => r.supplierId));
  const TYPE = { receipt: 'Kirim', return: 'Yetkazib beruvchiga qaytarish', service: 'Xizmat' };
  const kirimlar = [['Hujjat', 'Sana', 'Turi', 'Yetkazib beruvchi', 'Ombor', 'Summa', 'To\'landi (hujjatda)', 'To\'lanmagan (hujjatda)', 'Transport', 'Yuklash', 'Saqlash', 'Qo\'shimcha xarajat jami', 'Qo\'shimcha xarajat %']];
  const bySupplier = new Map();
  for (const r of receipts) {
    const total = money(r.total, r);
    const paid = money(r.paidAmount, r);
    const extra = money(r.extraTotal, r);
    kirimlar.push([r.number, r.date, TYPE[r.type] || r.type, supplierNames.get(r.supplierId) || '', whName.get(r.warehouseId) || '', total, paid, r2(total - paid), money(r.transportCost, r), money(r.loadingCost, r), money(r.storageCost, r), extra, pct(extra, total)]);
    const a = bySupplier.get(r.supplierId || 0) || { docs: 0, purchase: 0, returned: 0, services: 0, extra: 0 };
    a.docs++;
    if (r.type === 'receipt') a.purchase += total;
    else if (r.type === 'return') a.returned += total;
    else a.services += total;
    a.extra += extra;
    bySupplier.set(r.supplierId || 0, a);
  }
  const purchaseTotal = [...bySupplier.values()].reduce((t, a) => t + a.purchase, 0);
  const yetkazibBeruvchilar = [['Yetkazib beruvchi', 'Hujjatlar', 'Tovar xaridi', 'Xariddagi ulushi %', 'Qaytarilgan', 'Xizmatlar', 'Qo\'shimcha xarajatlar', 'Hozirgi qarzimiz (biz qarzdormiz)', 'Ular bizga qarzdor']];
  for (const [id, a] of [...bySupplier.entries()].sort((x, y) => y[1].purchase - x[1].purchase)) {
    const b = id ? balances[id] || 0 : 0;
    yetkazibBeruvchilar.push([id ? supplierNames.get(id) || `#${id}` : '(ko\'rsatilmagan)', a.docs, r2(a.purchase), pct(a.purchase, purchaseTotal), r2(a.returned), r2(a.services), r2(a.extra), b > 0.005 ? r2(b) : '', b < -0.005 ? r2(-b) : '']);
  }
  const recIds = receipts.filter((r) => r.type === 'receipt').map((r) => r.id);
  const recOf = new Map(receipts.map((r) => [r.id, r]));
  const narxOzgarishi = [['Tovar', 'Yetkazib beruvchi', 'Kirim sanasi', 'Hujjat', 'Oldingi kelish narxi', 'Yangi kelish narxi', 'O\'zgarish %', 'Soni', 'Hozirgi chakana narx', 'Hozirgi ustama %']];
  if (recIds.length) {
    const recItems = await ReceiptItem.findAll({ where: { receiptId: recIds, prevPurchasePrice: { [Op.gt]: 0 } }, attributes: ['receiptId', 'productId', 'quantity', 'purchasePrice', 'prevPurchasePrice'], raw: true });
    const changed = recItems
      .filter((i) => Math.abs(i.purchasePrice - i.prevPurchasePrice) > 0.005)
      .map((i) => ({ ...i, change: ((i.purchasePrice - i.prevPurchasePrice) / i.prevPurchasePrice) * 100 }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    for (const i of changed) {
      const r = recOf.get(i.receiptId);
      const p = productOf.get(i.productId);
      const buy = p ? priceNow(p.purchasePrice, p.currency) : 0;
      const retail = p ? priceNow(p.retailPrice, p.currency) : 0;
      narxOzgarishi.push([pName(i.productId), supplierNames.get(r.supplierId) || '', r.date, r.number, money(i.prevPurchasePrice, r), money(i.purchasePrice, r), r2(i.change), r2(i.quantity), r2(retail), buy > 0 ? pct(retail - buy, buy) : '']);
    }
  }

  // ================================================================ 5. Kassa va xarajatlar
  const cashDocs = await CashDocument.findAll({
    where: { posted: true, deleted: false, date: range },
    attributes: ['id', 'number', 'date', 'createdAt', 'type', 'partyType', 'terminal', 'currency', 'rate', 'cashAmount', 'comment', 'cashDeskId', 'contractorId', 'fromContractorId', 'toContractorId', 'articleId', 'userId'],
    raw: true,
  });
  const [deskNames, articleNames, partyNames, userNames] = await Promise.all([
    names(CashDesk, cashDocs.map((d) => d.cashDeskId)),
    names(CashArticle, cashDocs.map((d) => d.articleId)),
    names(Contractor, cashDocs.flatMap((d) => [d.contractorId, d.fromContractorId, d.toContractorId])),
    names(User, cashDocs.map((d) => d.userId)),
  ]);
  const PARTY = { contractor: 'Kontragent', employee: 'Xodim', other: 'Boshqa', investment: 'Investitsiya' };
  const KIND = { income: 'Kirim', expense: 'Chiqim', transfer: 'O\'tkazma' };
  const kassaOps = [['Hujjat', 'Sana', 'Vaqt', 'Turi', 'Tomon turi', 'Kontragent / xodim', 'Modda', 'Kassa', 'Summa', 'Terminal', 'Izoh', 'Foydalanuvchi']];
  const byArticle = new Map();
  for (const d of cashDocs) {
    const amount = money(d.cashAmount, d);
    const party = partyNames.get(d.contractorId) || [partyNames.get(d.fromContractorId), partyNames.get(d.toContractorId)].filter(Boolean).join(' -> ');
    kassaOps.push([d.number, d.date, timeOf(d.createdAt), KIND[d.type] || d.type, PARTY[d.partyType] || d.partyType, party, articleNames.get(d.articleId) || '', deskNames.get(d.cashDeskId) || '', amount, d.terminal ? 'ha' : '', d.comment || '', userNames.get(d.userId) || '']);
    if (d.type === 'transfer') continue;
    const key = `${KIND[d.type]}|${articleNames.get(d.articleId) || `(moddasiz) ${PARTY[d.partyType] || ''}`.trim()}`;
    const a = byArticle.get(key) || { count: 0, sum: 0, max: 0 };
    a.count++;
    a.sum += amount;
    a.max = Math.max(a.max, amount);
    byArticle.set(key, a);
  }
  const typeTotal = { Kirim: 0, Chiqim: 0 };
  for (const [k, a] of byArticle) typeTotal[k.split('|')[0]] += a.sum;
  const moddalar = [['Turi', 'Modda / tomon', 'Operatsiyalar soni', 'Summa', 'Shu turdagi ulushi %', 'Eng katta bitta operatsiya']];
  for (const [k, a] of [...byArticle.entries()].sort((x, y) => y[1].sum - x[1].sum)) {
    const [kind, name] = k.split('|');
    moddalar.push([kind, name, a.count, r2(a.sum), pct(a.sum, typeTotal[kind]), r2(a.max)]);
  }

  // ================================================================ 6. Qarzlar va kontragentlar
  const contractors = await Contractor.findAll({
    where: { deleted: false },
    attributes: ['id', 'name', 'categoryId', 'region', 'segment', 'creditLimit', 'paymentTerm', 'blacklisted', 'guarantor'],
    raw: true,
  });
  const ctCats = new Map((await Category.findAll({ attributes: ['id', 'name'], raw: true })).map((c) => [c.id, c.name]));
  const ctOf = new Map(contractors.map((c) => [c.id, c]));
  const buyByClient = new Map([...byClient.entries()].map(([id, c]) => [id, c.revenue]));
  // Eng eski to'lanmagan savat (qarzga sotuv) va kechikish - mijoz bo'yicha
  const credit = await Sale.findAll({ where: { onCredit: true, deleted: false }, attributes: ['id', 'number', 'date', 'currency', 'rate', 'total', 'clientId', 'dueDate'], raw: true });
  const openBaskets = credit
    .map((s) => ({ s, st: basketStatus.get(s.id) }))
    .filter((x) => x.st && x.st.debt > 0.005);
  const oldestBy = new Map();
  for (const { s } of openBaskets) {
    const cur = oldestBy.get(s.clientId);
    if (!cur || String(s.date) < cur.date) oldestBy.set(s.clientId, { date: String(s.date), due: s.dueDate ? String(s.dueDate) : '' });
  }
  const debitorlar = [['Kontragent', 'Kategoriya', 'Xodim', 'Bizga qarzi', 'Jami qarzdagi ulushi %', 'Kredit limiti', 'Limitdan oshganmi', 'Eng eski to\'lanmagan sotuv', 'Qarz yoshi (kun)', 'To\'lov muddatidan o\'tgan (kun)', 'Kafil bor', 'Qora ro\'yxat', 'Davrdagi xaridi']];
  const kreditorlar = [['Kontragent', 'Kategoriya', 'Biz qarzdormiz', 'Jami qarzimizdagi ulushi %', 'Davrdagi xaridimiz (kirim)']];
  const recv = pl.debts.receivable;
  const pay = pl.debts.payable;
  const debtorList = Object.entries(balances).filter(([, v]) => v < -0.005).sort((a, b) => a[1] - b[1]);
  for (const [idStr, v] of debtorList) {
    const id = Number(idStr);
    const c = ctOf.get(id);
    if (!c) continue;
    const old = oldestBy.get(id);
    debitorlar.push([c.name, ctCats.get(c.categoryId) || '', staff.has(id) ? 'ha' : '', r2(-v), pct(-v, recv), c.creditLimit || '', c.creditLimit > 0 && -v > c.creditLimit ? 'HA' : '', old?.date || '', old ? daysBetween(old.date, now) : '', old?.due && old.due < now ? daysBetween(old.due, now) : '', c.guarantor ? 'ha' : '', c.blacklisted ? 'ha' : '', buyByClient.has(id) ? r2(buyByClient.get(id)) : '']);
  }
  for (const [idStr, v] of Object.entries(balances).filter(([, x]) => x > 0.005).sort((a, b) => b[1] - a[1])) {
    const id = Number(idStr);
    const c = ctOf.get(id);
    if (!c) continue;
    kreditorlar.push([c.name, ctCats.get(c.categoryId) || '', r2(v), pct(v, pay), bySupplier.has(id) ? r2(bySupplier.get(id).purchase) : '']);
  }
  const savat = [['Sotuv', 'Sana', 'Mijoz', 'Summa', 'To\'landi', 'Qarz', 'To\'lov muddati', 'Muddatdan o\'tgan (kun)', 'Qarz yoshi (kun)']];
  const basketClientNames = await names(Contractor, openBaskets.map((x) => x.s.clientId));
  for (const { s, st } of openBaskets.sort((a, b) => b.st.debt - a.st.debt)) {
    savat.push([s.number, s.date, basketClientNames.get(s.clientId) || '', money(s.total - (st.returned || 0), s), money(st.paid, s), money(st.debt, s), s.dueDate || '', s.dueDate && String(s.dueDate) < now ? daysBetween(String(s.dueDate), now) : '', daysBetween(String(s.date), now)]);
  }
  const kontragentlar = [['Kontragent', 'Kategoriya', 'Hudud', 'Segment', 'Xodim', 'Balans (+ biz qarzdormiz, - ular qarzdor)', 'Kredit limiti', 'To\'lov muddati (kun)', 'Qora ro\'yxat', 'Davrdagi xaridi (sotuvimiz)', 'Davrdagi kirimi (xaridimiz)']];
  for (const c of contractors) {
    kontragentlar.push([c.name, ctCats.get(c.categoryId) || '', c.region || '', c.segment || '', staff.has(c.id) ? 'ha' : '', r2(balances[c.id] || 0), c.creditLimit || '', c.paymentTerm || '', c.blacklisted ? 'ha' : '', buyByClient.has(c.id) ? r2(buyByClient.get(c.id)) : '', bySupplier.has(c.id) ? r2(bySupplier.get(c.id).purchase) : '']);
  }

  // ================================================================ 7. Xodimlar va ish haqi
  const payrolls = await Payroll.findAll({
    where: { posted: true, deleted: false, date: range },
    attributes: ['id', 'number', 'date', 'period', 'currency', 'rate'],
    include: [{ model: PayrollItem, as: 'items', attributes: ['contractorId', 'amount'] }],
  });
  const empNames = await names(Contractor, [...staff, ...payrolls.flatMap((p) => p.items.map((i) => i.contractorId))]);
  const payByEmp = new Map();
  const oyliklar = [['Hujjat', 'Sana', 'Davr', 'Xodim', 'Summa']];
  for (const p of payrolls) {
    for (const i of p.items) {
      const amount = money(i.amount, p);
      oyliklar.push([p.number, p.date, p.period || '', empNames.get(i.contractorId) || '', amount]);
      const a = payByEmp.get(i.contractorId) || { sum: 0, periods: new Set() };
      a.sum += amount;
      a.periods.add(p.period || p.date);
      payByEmp.set(i.contractorId, a);
    }
  }
  const users = await User.findAll({ attributes: ['id', 'name', 'active', 'contractorId', 'owner'], include: [{ model: Role, as: 'role', attributes: ['name'] }] });
  const userByContractor = new Map(users.filter((u) => u.contractorId).map((u) => [u.contractorId, u]));
  const salesByUser = new Map([...byCashier.entries()].map(([id, k]) => [id, k]));
  const xodimlar = [['Xodim', 'Dasturda login bor', 'Rol', 'Faol', 'Davrda hisoblangan ish haqi', 'Davrlar soni', 'O\'rtacha bir davrga', 'Ish haqi fondidagi ulushi %', 'Kassir sifatida sotuvi (tushum)', 'Balans (+ biz qarzdormiz, - u qarzdor)']];
  const fund = [...payByEmp.values()].reduce((t, a) => t + a.sum, 0);
  for (const id of new Set([...staff, ...payByEmp.keys()])) {
    const u = userByContractor.get(id);
    const a = payByEmp.get(id);
    const sold = u ? salesByUser.get(u.id) : null;
    xodimlar.push([empNames.get(id) || `#${id}`, u ? 'ha' : '', u?.owner ? 'egasi' : u?.role?.name || '', u ? (u.active ? 'ha' : 'yo\'q') : '', a ? r2(a.sum) : '', a ? a.periods.size : '', a ? r2(a.sum / a.periods.size) : '', a ? pct(a.sum, fund) : '', sold ? r2(sold.revenue) : '', r2(balances[id] || 0)]);
  }

  // ================================================================ natija
  const section = (title, rows, note) => ({ title, note, rows });
  const files = [
    {
      name: '1-moliya-va-pul.csv',
      title: 'Moliyaviy natija, oylar dinamikasi, likvidlik, kassalar',
      sections: [
        section('Moliyaviy natija (davr uchun, Moliya hisoboti bilan bir xil)', moliyaNatija),
        section('Oylar bo\'yicha dinamika', oylar),
        section('Likvidlik: pul, qarzlar, tovar', likvidlik),
        section('Kassalar qoldig\'i (hozirgi holat)', kassalar),
      ],
    },
    {
      name: '2-sotuvlar.csv',
      title: 'Sotuvlar: tovarlar (ABC), mijozlar, kassirlar, vaqt, qaytarishlar',
      sections: [
        section('Tovarlar bo\'yicha sotuv (ABC: A - tushumning 80%, B - keyingi 15%, C - qolgani). Tovar tushumi sotuv hujjatidagi umumiy chegirma/ustamasiz', tovarSotuv),
        section('Mijozlar bo\'yicha sotuv', mijozSotuv),
        section('Kassirlar bo\'yicha sotuv', kassirSotuv),
        section('Hafta kunlari bo\'yicha', haftaKunlari),
        section('Soatlar bo\'yicha', soatlar),
        section('Mijozdan qaytarilgan tovarlar', qaytarishlar),
      ],
    },
    {
      name: '3-tovarlar-va-ombor.csv',
      title: 'Tovarlar qoldig\'i va aylanmasi, omborlar, ko\'chirishlar, spisaniya',
      sections: [
        section('Tovarlar: qoldiq, narx, ustama, aylanma va holat (barcha tovarlar)', tovarlar),
        section('Omborlar bo\'yicha qoldiq', omborlar),
        section('Ombordan omborga ko\'chirishlar (davr)', kochirishlar),
        section('Hisobdan chiqarish - spisaniya (davr)', spisaniya),
      ],
    },
    {
      name: '4-xaridlar.csv',
      title: 'Kirim (xarid) hujjatlari, yetkazib beruvchilar, kelish narxi o\'zgarishi',
      sections: [
        section('Yetkazib beruvchilar bo\'yicha', yetkazibBeruvchilar),
        section('Kelish narxi o\'zgargan tovarlar (davr kirimlarida)', narxOzgarishi),
        section('Kirim hujjatlari (davr)', kirimlar),
      ],
    },
    {
      name: '5-kassa-va-xarajatlar.csv',
      title: 'Kassa kirim-chiqimlari moddalar bo\'yicha va barcha kassa operatsiyalari',
      sections: [
        section('Kirim va chiqimlar moddalar / tomonlar bo\'yicha (davr)', moddalar),
        section('Barcha kassa operatsiyalari (davr)', kassaOps),
      ],
    },
    {
      name: '6-qarzlar-va-kontragentlar.csv',
      title: 'Debitorlar, kreditorlar, qarzga sotuvlar (savat), kontragentlar',
      sections: [
        section(`Debitorlar - bizga qarzdorlar (${pTo} holatiga)`, debitorlar),
        section(`Kreditorlar - biz qarzdormiz (${pTo} holatiga)`, kreditorlar),
        section('To\'lanmagan qarzga sotuvlar (savat, hozirgi holat)', savat),
        section('Barcha kontragentlar', kontragentlar),
      ],
    },
    {
      name: '7-xodimlar-va-ish-haqi.csv',
      title: 'Xodimlar, ish haqi, xodimlar balansi',
      sections: [section('Xodimlar', xodimlar), section('Ish haqi hisoblash (davr)', oyliklar)],
    },
  ];

  // Nazorat raqamlari: AI o'z hisob-kitobini shular bilan tekshiradi
  const control = {
    netRevenue: pl.net,
    grossProfit: pl.grossProfit,
    margin: pl.margin,
    expenses: pl.expenses.total,
    netProfit: pl.netProfit,
    receivable: pl.debts.receivable,
    payable: pl.debts.payable,
    stockCost: pl.stock.costValue,
    cash: pl.cash,
    salesCount: pl.count,
  };
  return { currency, from: pFrom, to: pTo, days: periodDays, control, files };
}

module.exports = { buildExport };
