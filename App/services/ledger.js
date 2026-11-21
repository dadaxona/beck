'use strict';

/**
 * Kontragentlar bilan hisob-kitob daftari (1C dagi o'zaro hisob-kitoblar).
 *
 * Har bir harakat `amount` bilan: MUSBAT = do'kon kontragentga qarzdor bo'ladi (yoki ularning qarzi kamayadi),
 * MANFIY = kontragent do'konga qarzdor bo'ladi (yoki do'konning qarzi kamayadi).
 *
 *  + Tovar/xizmat kirimi              (yetkazib beruvchiga qarzimiz oshadi)
 *  - Yetkazib beruvchiga qaytarish    (qarzimiz kamayadi)
 *  - Savat: to'lanmagan sotuv         (kontragent bizga qarzdor bo'ladi; keyin Kassaga kirim bilan yopiladi)
 *  + Oylik hisoblash                  (xodimga qarzimiz oshadi)
 *  + Kassaga kirim (undan pul oldik)  (uning qarzi kamayadi / bizning qarzimiz oshadi)
 *  - Kassadan chiqim (unga pul berdik)(qarzimiz kamayadi / uning qarzi oshadi)
 *  O'tkazma: yuboruvchidan -, qabul qiluvchiga +
 *
 * Natija: balans > 0  => "Biz qarzdormiz", balans < 0 => "Ular qarzdor".
 *
 * Valyutalar: har bir harakat o'z valyutasi va hujjatdagi kursi bilan yig'iladi, so'ng so'ralgan valyutaga
 * o'giriladi (currencies.converter): o'z valyutasida - asl summa, boshqa valyutadagi hujjat - o'sha paytdagi
 * kurs bo'yicha so'mga, so'mdan so'ralgan valyutaga hozirgi kurs bo'yicha.
 */

const { Receipt, Sale, CashDocument, Payroll, PayrollItem, SaleReturn, Contractor } = require('../../models');
const currencies = require('./currencies');

const round = (v) => Math.round(v * 100) / 100;

async function collectMovements({ contractorId = null, currency = null } = {}) {
  const movements = [];
  const conv = await currencies.converter();
  const hidden = contractorId
    ? new Set()
    : new Set((await Contractor.findAll({ where: { deleted: true }, attributes: ['id'], raw: true })).map((c) => c.id));
  const push = (m) => {
    if (!m.contractorId || hidden.has(m.contractorId)) return;
    if (contractorId && m.contractorId !== contractorId) return;
    // Valyuta berilsa - shu valyutaga o'giriladi (asl summa va valyuta docAmount/docCurrency da qoladi)
    if (currency) {
      movements.push({ ...m, docCurrency: m.currency, docAmount: m.amount, amount: conv(m.amount, m.currency, m.rate, currency), currency });
    } else movements.push(m);
  };

  const [receipts, sales, cash, payrolls, saleReturns] = await Promise.all([
    Receipt.findAll({ where: { posted: true }, raw: true }),
    Sale.findAll({ where: { onCredit: true, deleted: false }, raw: true }),
    CashDocument.findAll({ where: { posted: true }, raw: true }),
    Payroll.findAll({ where: { posted: true }, raw: true }),
    SaleReturn.findAll({ where: { posted: true }, raw: true }),
  ]);
  const items = payrolls.length
    ? await PayrollItem.findAll({ where: { payrollId: payrolls.map((p) => p.id) }, raw: true })
    : [];

  for (const r of receipts) {
    push({
      contractorId: r.supplierId,
      currency: r.currency,
      rate: r.rate,
      amount: r.type === 'return' ? -r.total : r.total,
      kind: r.type, // receipt | return | service
      docId: r.id,
      number: r.number,
      date: r.date,
      createdAt: r.createdAt,
      comment: r.note,
    });
  }

  for (const s of sales) {
    push({
      contractorId: s.clientId,
      currency: s.currency,
      rate: s.rate,
      amount: -(s.total - s.paidAmount), // faqat to'lanmagan qismi (sotuv vaqtida to'langani qarz emas)
      kind: 'basket',
      docId: s.id,
      number: s.number,
      date: s.date,
      createdAt: s.createdAt,
      comment: '',
    });
  }

  for (const d of cash) {
    const base = { docId: d.id, number: d.number, date: d.date, createdAt: d.createdAt, comment: d.comment };
    if (d.type === 'income') {
      push({ ...base, contractorId: d.contractorId, currency: d.accountCurrency, rate: d.accountRate, amount: d.accountAmount, kind: 'cash_income' });
    } else if (d.type === 'expense') {
      push({ ...base, contractorId: d.contractorId, currency: d.accountCurrency, rate: d.accountRate, amount: -d.accountAmount, kind: 'cash_expense' });
    } else if (d.type === 'transfer') {
      push({ ...base, contractorId: d.fromContractorId, currency: d.currency, rate: d.rate, amount: -d.cashAmount, kind: 'transfer_out' });
      push({ ...base, contractorId: d.toContractorId, currency: d.accountCurrency, rate: d.accountRate, amount: d.accountAmount, kind: 'transfer_in' });
    }
  }

  // Mijozdan qaytarish: tovar qiymati mijozning qarzidan ayriladi (yoki bizning qarzimiz oshadi),
  // qaytarilgan pul esa buning aksi. Oddiy mijoz va to'liq pul qaytarilgan to'langan sotuvlar uchun harakat yo'q.
  for (const r of saleReturns) {
    const net = r.total - r.refund;
    if (!r.clientId || (!r.onCredit && net <= 0.005)) continue;
    const base = { contractorId: r.clientId, currency: r.currency, rate: r.rate, docId: r.id, number: r.number, date: r.date, createdAt: r.createdAt, comment: r.comment };
    push({ ...base, amount: r.total, kind: 'sale_return' });
    if (r.refund > 0.005) push({ ...base, amount: -r.refund, kind: 'sale_return_refund' });
  }

  const payrollById = new Map(payrolls.map((p) => [p.id, p]));
  for (const i of items) {
    const p = payrollById.get(i.payrollId);
    push({
      contractorId: i.contractorId,
      currency: p.currency,
      rate: p.rate,
      amount: i.amount,
      kind: 'payroll',
      docId: p.id,
      number: p.number,
      date: p.date,
      createdAt: p.createdAt,
      comment: p.period ? `${p.period}${p.comment ? ` · ${p.comment}` : ''}` : p.comment,
    });
  }

  return movements;
}

/** Bitta kontragent balansi (barcha valyutalardagi harakatlar berilgan valyutaga o'girilgan) */
async function contractorBalance(id, currency) {
  const movements = await collectMovements({ contractorId: id, currency });
  return round(movements.reduce((s, m) => s + m.amount, 0));
}

/** Barcha kontragentlar balansi: { [contractorId]: balans } */
async function balancesByContractor(currency, to = null) {
  const movements = (await collectMovements({ currency })).filter((m) => !to || String(m.date) <= to);
  const map = {};
  for (const m of movements) map[m.contractorId] = (map[m.contractorId] || 0) + m.amount;
  for (const id of Object.keys(map)) map[id] = round(map[id]);
  return map;
}

/** Hisob-kitoblar kitobi (akt sverka): harakatlar + yig'ilib boruvchi balans */
async function contractorLedger(id, currency, to = null) {
  const movements = (await collectMovements({ contractorId: id, currency })).filter((m) => !to || String(m.date) <= to);
  movements.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)) || a.docId - b.docId);
  let running = 0;
  return movements.map((m) => {
    running = round(running + m.amount);
    return { ...m, amount: round(m.amount), balance: running };
  });
}

/**
 * Tashkilot hisobidagi Debet / Kredit (1C akt sverkasi):
 *  Debet  = kontragent bizga qarzdor bo'lishi (yoki bizning qarzimiz kamayishi)
 *  Kredit = biz kontragentga qarzdor bo'lishi (yoki uning qarzi kamayishi)
 * Mijozdan qaytarish "storno" ko'rinishida: sotuv ustunidagi (Debet) manfiy summa.
 * Kontragent tomoni bunga teskari (Debet <-> Kredit).
 */
function companySide(m) {
  if (m.kind === 'sale_return') return { debit: round(-m.amount), credit: 0 };
  return m.amount < 0 ? { debit: round(-m.amount), credit: 0 } : { debit: 0, credit: round(m.amount) };
}

/**
 * Akt sverka (o'zaro hisob-kitoblarni solishtirish): davr boshiga saldo, davr ichidagi harakatlar,
 * aylanma (Debet/Kredit jami) va davr oxiriga saldo.
 * Saldo ishorasi: musbat = biz qarzdormiz (Kredit), manfiy = kontragent qarzdor (Debet).
 */
async function contractorStatement(id, currency, from, to) {
  const movements = await collectMovements({ contractorId: id, currency });
  movements.sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.createdAt).localeCompare(String(b.createdAt)) ||
      a.docId - b.docId,
  );

  const before = movements.filter((m) => from && String(m.date) < from);
  const inPeriod = movements.filter((m) => (!from || String(m.date) >= from) && (!to || String(m.date) <= to));

  const opening = round(before.reduce((s, m) => s + m.amount, 0));
  const rows = inPeriod.map((m) => ({ ...m, amount: round(m.amount), ...companySide(m) }));
  const turnover = {
    debit: round(rows.reduce((s, r) => s + r.debit, 0)),
    credit: round(rows.reduce((s, r) => s + r.credit, 0)),
  };
  const closing = round(opening + inPeriod.reduce((s, m) => s + m.amount, 0));
  return { opening, rows, turnover, closing };
}

module.exports = { collectMovements, contractorBalance, balancesByContractor, contractorLedger, contractorStatement };
