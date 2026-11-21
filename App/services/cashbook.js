'use strict';

/**
 * Kassa qoldig'i. Qoldiq = Kassaga kirim - Kassadan chiqim
 *                          + sotuv vaqtida olingan to'lovlar
 *                          - mijozlarga qaytarilgan pul (qaytarish hujjatlari)
 */

const { Op } = require('sequelize');
const { CashDesk, CashDocument, Sale, SalePayment, SaleReturnPayment } = require('../../models');

const round = (v) => Math.round(v * 100) / 100;
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Kassadagi qoldiq (kassa valyutasida). deskId bo'lmasa barcha kassalar bo'yicha. */
async function deskBalance(deskId, currency, t) {
  const where = { posted: true, currency, type: { [Op.in]: ['income', 'expense'] } };
  if (deskId) where.cashDeskId = deskId;
  const docs = await CashDocument.findAll({ where, attributes: ['type', 'cashAmount'], raw: true, transaction: t });
  const cash = docs.reduce((s, d) => s + (d.type === 'income' ? d.cashAmount : -d.cashAmount), 0);

  const payWhere = { currency };
  if (deskId) payWhere.cashDeskId = deskId;
  const [sales, refunds] = await Promise.all([
    // O'chirishga belgilangan sotuvning to'lovi kassada hisoblanmaydi
    SalePayment.findAll({
      where: payWhere,
      attributes: ['amount'],
      include: [{ model: Sale, attributes: [], where: { deleted: false }, required: true }],
      raw: true,
      transaction: t,
    }),
    SaleReturnPayment.findAll({ where: payWhere, attributes: ['amount'], raw: true, transaction: t }),
  ]);
  const received = sales.reduce((s, p) => s + p.amount, 0);
  const refunded = refunds.reduce((s, p) => s + p.amount, 0);
  return round(cash + received - refunded);
}

/** Kassa hech qachon manfiy qoldiqqa tushmasligi kerak */
async function assertNonNegative(pairs, t) {
  const seen = new Set();
  for (const { deskId, currency } of pairs) {
    if (!deskId || seen.has(`${deskId}:${currency}`)) continue;
    seen.add(`${deskId}:${currency}`);
    const balance = await deskBalance(deskId, currency, t);
    if (balance < -0.005) {
      const desk = await CashDesk.findByPk(deskId, { transaction: t });
      throw fail(400, `Kassada mablag' yetarli emas: "${desk?.name}" kassasida ${-balance} ${currency} yetishmaydi`);
    }
  }
}

module.exports = { deskBalance, assertNonNegative };
