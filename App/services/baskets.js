'use strict';

/**
 * Savat (qarzga/to'lovsiz sotuvlar) holati.
 *
 * Sotuv vaqtida to'liq to'langan sotuv "Sotuvlar" jurnalida bo'ladi.
 * To'lanmagan (yoki qisman to'langan) sotuv "Savat" jurnaliga tushadi.
 * Mijoz keyin Kassaga kirim orqali pul bersa, u eng eskisidan boshlab savatlarni yopadi (FIFO),
 * savat esa arxivda "to'langan" bo'lib qoladi.
 */

const { Op } = require('sequelize');
const { Sale, CashDocument, SaleReturn } = require('../../models');
const returnsService = require('./returns');

const round = (v) => Math.round(v * 100) / 100;

/** { saleId -> { paid, debt, status } } faqat savatdagi (onCredit) sotuvlar uchun */
async function computeStatuses() {
  const returns = await returnsService.summary();
  const [baskets, cash, saleReturns] = await Promise.all([
    Sale.findAll({
      where: { onCredit: true, deleted: false },
      attributes: ['id', 'clientId', 'currency', 'total', 'paidAmount', 'date', 'createdAt'],
      raw: true,
    }),
    CashDocument.findAll({ where: { posted: true }, raw: true }),
    SaleReturn.findAll({ where: { posted: true }, attributes: ['clientId', 'currency', 'total', 'refund', 'onCredit'], raw: true }),
  ]);

  /*
   * Mijoz + valyuta bo'yicha savatlarni yopishga ishlatiladigan summa. Hisob-kitob kitobi (ledger) bilan bir xil:
   *  + kassaga kirim (undan pul oldik), unga o'tkazma
   *  - kassadan chiqim (unga pul berdik: masalan ortiqcha to'lovni qaytardik), undan o'tkazma
   *  - savatdagi sotuv bo'yicha qaytarishda unga qaytarilgan pul (qaytgan tovar savat summasidan alohida ayriladi)
   *  + to'langan sotuvni qaytarib, pul to'liq qaytarilmagan qismi (uning foydasiga yozilgan)
   */
  const pool = new Map();
  const add = (contractorId, currency, amount) => {
    if (!contractorId) return;
    const key = `${contractorId}:${currency}`;
    pool.set(key, (pool.get(key) || 0) + amount);
  };
  for (const d of cash) {
    if (d.partyType === 'other') continue;
    if (d.type === 'income') add(d.contractorId, d.accountCurrency, d.accountAmount);
    if (d.type === 'expense') add(d.contractorId, d.accountCurrency, -d.accountAmount);
    if (d.type === 'transfer') {
      add(d.toContractorId, d.accountCurrency, d.accountAmount);
      add(d.fromContractorId, d.currency, -d.cashAmount);
    }
  }
  for (const r of saleReturns) {
    if (r.onCredit) add(r.clientId, r.currency, -r.refund);
    else if (r.total - r.refund > 0.005) add(r.clientId, r.currency, r.total - r.refund);
  }

  baskets.sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.createdAt).localeCompare(String(b.createdAt)) ||
      a.id - b.id,
  );

  const result = new Map();
  for (const s of baskets) {
    const key = `${s.clientId}:${s.currency}`;
    // Qaytarilgan tovarlar summasi sotuv summasidan ayriladi
    const returned = returns.bySale.get(s.id) || 0;
    const effectiveTotal = Math.max(s.total - returned, 0);
    const remaining = Math.max(effectiveTotal - s.paidAmount, 0);
    const available = Math.max(pool.get(key) || 0, 0);
    const take = Math.min(available, remaining);
    pool.set(key, available - take);

    const paid = round(s.paidAmount + take);
    const debt = round(Math.max(effectiveTotal - paid, 0));
    result.set(s.id, { returned: round(returned), paid, debt, status: debt <= 0.005 ? 'paid' : paid > 0.005 ? 'partial' : 'unpaid' });
  }
  return result;
}

module.exports = { computeStatuses };
