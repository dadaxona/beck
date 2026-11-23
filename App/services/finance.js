'use strict';

/**
 * Moliyaviy ko'rsatkichlar (dashboard va "Moliya hisoboti" sahifasi uchun).
 *
 * Hammasi BIR valyutada (currency) ko'rsatiladi: boshqa valyutadagi hujjatlar o'sha paytdagi kurs bo'yicha
 * so'mga, so'mdan tanlangan valyutaga hozirgi kurs bo'yicha o'giriladi (currencies.converter).
 * Ombordagi tovar va kassadagi pul esa hozirgi kurs bo'yicha baholanadi.
 *  Sof savdo     = sotuvlar jami - mijozdan qaytarilgan tovar summasi
 *  Tannarx       = sotilgan tovarning olish narxi (sotuv paytida saqlangan) - qaytarilganining tannarxi
 *  Yalpi foyda   = sof savdo - tannarx
 *  Xarajatlar    = oylik hisoblash + xizmat kirimi + kirimdagi qo'shimcha xarajatlar (transport, yuklash, saqlash)
 *                  + spisat (hisobdan chiqarilgan tovar) + kassadan chiqim (kontragentsiz, "boshqa")
 *  Boshqa daromad= kassaga kirim (kontragentsiz, "boshqa")
 *  Sof foyda     = yalpi foyda - xarajatlar + boshqa daromad            (qarzlar HISOBGA OLINGAN: qarzga sotilgani ham daromad)
 *  Qarzlarsiz    = sof foyda - davr sotuvlarining hali to'lanmagan qismi (qarzlar HISOBGA OLINMAGAN: faqat haqiqatda olingan pul)
 */

const { Op } = require('sequelize');
const {
  Sale, SaleItem, SaleReturn, SaleReturnItem, Receipt, Payroll, CashDocument, StockBalance, Product, Contractor,
  WriteOff, WriteOffReturn,
} = require('../../models');
const baskets = require('./baskets');
const ledger = require('./ledger');
const cashbook = require('./cashbook');
const returnsService = require('./returns');
const { today } = require('../utils/date');
const currencies = require('./currencies');

const round = (v) => Math.round(v * 100) / 100;
const sum = (rows, pick) => rows.reduce((s, r) => s + pick(r), 0);
const inRange = (d, from, to) => (!from || String(d) >= from) && (!to || String(d) <= to);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return iso(new Date(y, m - 1, d + n));
};

/** Valyuta bo'yicha barcha kerakli yozuvlarni bir marta yuklaydi (keyin summarize istalgan davr uchun ishlaydi) */
async function loadData(currency) {
  const conv = await currencies.converter();
  const to = (amount, row) => conv(amount, row.currency, row.rate, currency);
  const [sales, returns, returnItems, payrolls, services, cashOther, statuses, writeOffs, writeOffReturns, receiptExtras, hiddenClients] = await Promise.all([
    Sale.findAll({ where: { deleted: false }, attributes: ['id', 'date', 'total', 'costTotal', 'clientId', 'currency', 'rate'], raw: true }),
    SaleReturn.findAll({ where: { posted: true }, attributes: ['id', 'date', 'total', 'currency', 'rate'], raw: true }),
    SaleReturnItem.findAll({ attributes: ['saleReturnId', 'saleItemId', 'quantity'], raw: true }),
    Payroll.findAll({ where: { posted: true }, attributes: ['date', 'total', 'currency', 'rate'], raw: true }),
    Receipt.findAll({ where: { posted: true, type: 'service' }, attributes: ['date', 'total', 'currency', 'rate'], raw: true }),
    CashDocument.findAll({
      where: { posted: true, partyType: 'other', type: { [Op.in]: ['income', 'expense'] } },
      attributes: ['date', 'type', 'cashAmount', 'currency', 'rate'],
      raw: true,
    }),
    baskets.computeStatuses(),
    WriteOff.findAll({ where: { posted: true }, attributes: ['id', 'date', 'quantity', 'costPrice', 'currency', 'rate'], raw: true }),
    WriteOffReturn.findAll({ attributes: ['writeOffId', 'quantity'], raw: true }),
    Receipt.findAll({ where: { posted: true, extraTotal: { [Op.gt]: 0 } }, attributes: ['date', 'extraTotal', 'currency', 'rate'], raw: true }),
    Contractor.findAll({ where: { deleted: true }, attributes: ['id'], raw: true }),
  ]);
  // O'chirishga belgilangan mijozlarning qarzi (qarz hisobotlaridagi kabi) to'lanmaganlarga kirmaydi
  const hidden = new Set(hiddenClients.map((c) => c.id));

  // Spisat zarari = (spisat soni - qaytarilgani) * olish narxi
  const backQty = new Map();
  for (const r of writeOffReturns) backQty.set(r.writeOffId, (backQty.get(r.writeOffId) || 0) + r.quantity);

  // Qaytarilgan tovarning tannarxi (sotuv qatoridagi olish narxi bo'yicha)
  const itemIds = [...new Set(returnItems.map((i) => i.saleItemId))];
  const saleItems = itemIds.length
    ? await SaleItem.findAll({ where: { id: itemIds }, attributes: ['id', 'costPrice'], raw: true })
    : [];
  const costOf = new Map(saleItems.map((i) => [i.id, i.costPrice]));
  const returnCost = new Map();
  for (const i of returnItems) {
    returnCost.set(i.saleReturnId, (returnCost.get(i.saleReturnId) || 0) + i.quantity * (costOf.get(i.saleItemId) || 0));
  }

  // Hammasi tanlangan valyutaga o'giriladi (sotuv tannarxi va qaytarish tannarxi sotuv valyutasida saqlangan)
  return {
    sales: sales.map((s) => ({
      date: s.date,
      total: to(s.total, s),
      costTotal: to(s.costTotal, s),
      debt: hidden.has(s.clientId) ? 0 : to(statuses.get(s.id)?.debt || 0, s),
    })),
    returns: returns.map((r) => ({ date: r.date, total: to(r.total, r), cost: to(returnCost.get(r.id) || 0, r) })),
    payrolls: payrolls.map((p) => ({ date: p.date, total: to(p.total, p) })),
    services: services.map((p) => ({ date: p.date, total: to(p.total, p) })),
    cashOther: cashOther.map((c) => ({ date: c.date, type: c.type, cashAmount: to(c.cashAmount, c) })),
    receiptExtras: receiptExtras.map((r) => ({ date: r.date, extraTotal: to(r.extraTotal, r) })),
    // Investitsiya (tashqaridan kiritilgan pul): daromad emas - foydaga kirmaydi, faqat ma'lumot uchun
    investments: (
      await CashDocument.findAll({ where: { posted: true, partyType: 'investment' }, attributes: ['date', 'cashAmount', 'currency', 'rate'], raw: true })
    ).map((c) => ({ date: c.date, amount: to(c.cashAmount, c) })),
    writeOffs: writeOffs.map((w) => ({ date: w.date, loss: to(Math.max(w.quantity - (backQty.get(w.id) || 0), 0) * w.costPrice, w) })),
  };
}

/** Davr (from..to, ikkalasi ham kiradi) uchun ko'rsatkichlar */
function summarize(data, from, to) {
  const sales = data.sales.filter((s) => inRange(s.date, from, to));
  const returns = data.returns.filter((r) => inRange(r.date, from, to));
  const cash = data.cashOther.filter((c) => inRange(c.date, from, to));

  const gross = sum(sales, (s) => s.total);
  const returned = sum(returns, (r) => r.total);
  const net = gross - returned;
  const cost = sum(sales, (s) => s.costTotal) - sum(returns, (r) => r.cost);
  const grossProfit = net - cost;

  const payroll = sum(data.payrolls.filter((p) => inRange(p.date, from, to)), (p) => p.total);
  const services = sum(data.services.filter((p) => inRange(p.date, from, to)), (p) => p.total);
  const writeOff = sum(data.writeOffs.filter((w) => inRange(w.date, from, to)), (w) => w.loss);
  const receiptExtra = sum(data.receiptExtras.filter((r) => inRange(r.date, from, to)), (r) => r.extraTotal);
  const otherExpense = sum(cash.filter((c) => c.type === 'expense'), (c) => c.cashAmount);
  const otherIncome = sum(cash.filter((c) => c.type === 'income'), (c) => c.cashAmount);
  const expenses = payroll + services + receiptExtra + writeOff + otherExpense;

  const netProfit = grossProfit - expenses + otherIncome;
  const unpaid = sum(sales, (s) => s.debt);

  return {
    count: sales.length,
    gross: round(gross),
    returned: round(returned),
    net: round(net),
    cost: round(cost),
    grossProfit: round(grossProfit),
    margin: net > 0.005 ? round((grossProfit / net) * 100) : 0,
    expenses: {
      payroll: round(payroll),
      services: round(services),
      receiptExtra: round(receiptExtra),
      writeOff: round(writeOff),
      other: round(otherExpense),
      total: round(expenses),
    },
    otherIncome: round(otherIncome),
    investments: round(sum((data.investments || []).filter((c) => inRange(c.date, from, to)), (c) => c.amount)),
    netProfit: round(netProfit),
    unpaid: round(unpaid),
    cashProfit: round(netProfit - unpaid),
  };
}

/** Kontragentlar qarzi (sana bo'yicha): olinadigan = ular bizga qarzdor, beriladigan = biz qarzdormiz */
async function debts(currency, to) {
  const balances = await ledger.balancesByContractor(currency, to || null);
  let receivable = 0;
  let payable = 0;
  let receivableCount = 0;
  let payableCount = 0;
  for (const v of Object.values(balances)) {
    if (v < -0.005) {
      receivable += -v;
      receivableCount++;
    } else if (v > 0.005) {
      payable += v;
      payableCount++;
    }
  }
  return {
    receivable: round(receivable),
    receivableCount,
    payable: round(payable),
    payableCount,
    net: round(receivable - payable),
    balances,
  };
}

/** Omborda hozir turgan tovar: olish va sotish narxida (tovar valyutasidan hozirgi kurs bo'yicha o'girilgan) */
async function stock(currency = 'UZS') {
  const conv = await currencies.converter();
  const [balances, products] = await Promise.all([
    StockBalance.findAll({ attributes: ['productId', 'quantity'], raw: true }),
    Product.findAll({ where: { deleted: false }, attributes: ['id', 'purchasePrice', 'retailPrice', 'currency'], raw: true }),
  ]);
  const price = new Map(products.map((p) => [p.id, p]));
  const qty = new Map();
  for (const b of balances) qty.set(b.productId, (qty.get(b.productId) || 0) + b.quantity);

  let costValue = 0;
  let retailValue = 0;
  let quantity = 0;
  let kinds = 0;
  for (const [id, q] of qty) {
    const p = price.get(id);
    if (!p || q <= 0.0005) continue;
    costValue += q * conv(p.purchasePrice, p.currency, null, currency);
    retailValue += q * conv(p.retailPrice, p.currency, null, currency);
    quantity += q;
    kinds++;
  }
  return { costValue: round(costValue), retailValue: round(retailValue), quantity: round(quantity), kinds };
}

/** Barcha kassalardagi pul (har valyutadagi qoldiq hozirgi kurs bo'yicha tanlangan valyutaga o'girilib) */
async function cashTotal(currency) {
  const conv = await currencies.converter();
  let total = 0;
  for (const c of await currencies.list()) total += conv(await cashbook.deskBalance(null, c.code), c.code, null, currency);
  return round(total);
}

/** "Moliya hisoboti" sahifasi */
async function financeReport(currency, from, to) {
  const data = await loadData(currency);
  const [d, st, cashBalance] = await Promise.all([debts(currency, to), stock(currency), cashTotal(currency)]);
  const { balances, ...debt } = d; // eslint-disable-line no-unused-vars
  return { currency, from: from || null, to: to || null, ...summarize(data, from, to), debts: debt, stock: st, cash: cashBalance };
}

/** Dashboard: bugun/oy, qarzlar, ombor, kassa, 30 kunlik va 6 oylik grafik, top tovarlar va qarzdorlar */
async function dashboard(currency) {
  const now = today();
  const data = await loadData(currency);

  const days = Array.from({ length: 30 }, (_, i) => addDays(now, i - 29));
  const daily = days.map((date) => ({ date, sales: summarize(data, date, date).net }));

  const [y, m] = now.split('-').map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const first = new Date(y, m - 1 - (5 - i), 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const s = summarize(data, iso(first), iso(last));
    return { month: `${first.getFullYear()}-${pad(first.getMonth() + 1)}`, sales: s.net, profit: s.netProfit };
  });

  const todaySum = summarize(data, now, now);
  const monthSum = summarize(data, `${now.slice(0, 8)}01`, now);

  const [d, st, cashBalance, items, returns] = await Promise.all([
    debts(currency, now),
    stock(currency),
    cashTotal(currency),
    SaleItem.findAll({
      include: [{ model: Sale, attributes: ['currency', 'rate'], required: true, where: { deleted: false, date: { [Op.gte]: days[0] } } }],
      attributes: ['id', 'productId', 'quantity', 'sum'],
      raw: true,
    }),
    returnsService.summary(),
  ]);

  // Eng ko'p sotilgan tovarlar (30 kun, qaytarilgani ayrilgan)
  // Summa tanlangan valyutada (sotuv paytidagi kurs bo'yicha)
  const conv = await currencies.converter();
  const byProduct = new Map();
  for (const i of items) {
    const unit = i.quantity ? conv(i.sum, i['Sale.currency'], i['Sale.rate'], currency) / i.quantity : 0;
    const back = returns.byItem.get(i.id) || 0;
    const cur = byProduct.get(i.productId) || { sum: 0, qty: 0 };
    cur.sum += unit * (i.quantity - back);
    cur.qty += i.quantity - back;
    byProduct.set(i.productId, cur);
  }
  const topIds = [...byProduct.entries()].filter(([, v]) => v.sum > 0.005).sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);
  const productNames = topIds.length
    ? new Map((await Product.findAll({ where: { id: topIds.map(([id]) => id) }, attributes: ['id', 'name'], raw: true })).map((p) => [p.id, p.name]))
    : new Map();

  // Eng katta qarzdorlar (ular bizga qarzdor)
  const debtorIds = Object.entries(d.balances)
    .filter(([, v]) => v < -0.005)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5);
  const contractorNames = debtorIds.length
    ? new Map((await Contractor.findAll({ where: { id: debtorIds.map(([id]) => Number(id)) }, attributes: ['id', 'name'], raw: true })).map((c) => [c.id, c.name]))
    : new Map();

  const { balances, ...debt } = d; // eslint-disable-line no-unused-vars
  return {
    currency,
    today: { sales: todaySum.net, count: todaySum.count },
    month: { sales: monthSum.net, profit: monthSum.netProfit, count: monthSum.count },
    debts: debt,
    stock: st,
    cash: cashBalance,
    daily,
    months,
    topProducts: topIds.map(([id, v]) => ({ id, name: productNames.get(id) || `#${id}`, sum: round(v.sum), qty: round(v.qty) })),
    topDebtors: debtorIds.map(([id, v]) => ({ id: Number(id), name: contractorNames.get(Number(id)) || `#${id}`, amount: round(-v) })),
  };
}

module.exports = { financeReport, dashboard, summarize, loadData };
