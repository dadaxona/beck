'use strict';

const { SaleReturn, SaleReturnItem } = require('../../models');

/**
 * Provodka qilingan qaytarishlar bo'yicha yig'indi:
 *  byItem: sotuv qatori -> qaytarilgan soni
 *  bySale: sotuv -> qaytarilgan summa
 */
async function summary() {
  const [returns, items] = await Promise.all([
    SaleReturn.findAll({ where: { posted: true }, attributes: ['id', 'saleId', 'total'], raw: true }),
    SaleReturnItem.findAll({ attributes: ['saleReturnId', 'saleItemId', 'quantity'], raw: true }),
  ]);

  const posted = new Set(returns.map((r) => r.id));
  const bySale = new Map();
  const byItem = new Map();
  for (const r of returns) bySale.set(r.saleId, (bySale.get(r.saleId) || 0) + r.total);
  for (const i of items) {
    if (posted.has(i.saleReturnId)) byItem.set(i.saleItemId, (byItem.get(i.saleItemId) || 0) + i.quantity);
  }
  return { bySale, byItem };
}

module.exports = { summary };
