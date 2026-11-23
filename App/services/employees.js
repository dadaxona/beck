'use strict';

/**
 * Xodim kontragentlar: dastur xodimni uch joyda ishlatadi -
 *  1) unga login berilgan (Sozlamalar → Foydalanuvchilar: foydalanuvchi = kontragent);
 *  2) oylik hujjatida (Oylik);
 *  3) kassa hujjatida "Xodim" turi bilan (avans, maosh berish ...).
 * Shulardan biriga tushgan kontragent - xodim, qolganlari - mijoz/hamkor. Joriy tashkilot ichida.
 */
const { User, PayrollItem, CashDocument } = require('../../models');
const { Op } = require('sequelize');

async function employeeIds() {
  const [users, payroll, cash] = await Promise.all([
    User.findAll({ where: { contractorId: { [Op.ne]: null } }, attributes: ['contractorId'], raw: true }),
    PayrollItem.findAll({ attributes: ['contractorId'], raw: true }),
    CashDocument.findAll({ where: { partyType: 'employee', contractorId: { [Op.ne]: null } }, attributes: ['contractorId'], raw: true }),
  ]);
  return new Set([...users, ...payroll, ...cash].map((r) => r.contractorId).filter(Boolean));
}

module.exports = { employeeIds };
