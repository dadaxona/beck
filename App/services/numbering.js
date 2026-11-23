'use strict';

/**
 * Hujjat raqamlari har bir tashkilot uchun alohida: yangi mijozning birinchi sotuvi S-1 (platformadagi
 * umumiy ID emas - u boshqa mijozlar hajmini ham oshkor qilardi va raqamlarda "teshik" qoldirardi).
 *
 * Hisoblagich Setting jadvalida ("seq:<Model>" kaliti, tashkilot ichida noyob), hujjat bilan BIR tranzaksiyada
 * qulflanib oshiriladi - parallel hujjatlar bir xil raqam olmaydi.
 * Birinchi marta: shu tashkilotdagi mavjud raqamlarning eng kattasidan davom etadi (to'qnashmaydi).
 */
const { UniqueConstraintError } = require('sequelize');
const db = require('../../models');

const MODELS = ['Sale', 'Receipt', 'CashDocument', 'Payroll', 'SaleReturn', 'WriteOff', 'StockTransfer', 'Order'];

/** Mavjud raqamlarning eng kattasi (masalan "S-12" -> 12). Raqamsiz ('') hujjatlar hisobga kirmaydi */
async function maxNumber(model, transaction) {
  const rows = await model.findAll({ attributes: ['number'], raw: true, transaction });
  return rows.reduce((m, r) => {
    const match = /-(\d+)$/.exec(String(r.number || ''));
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
}

/** Joriy tashkilotning barcha hisoblagichlari mavjud bo'lsin (yo'g'i yaratiladi). Tashkilot kontekstida. */
async function ensureCounters(transaction) {
  for (const name of MODELS) {
    const key = `seq:${name}`;
    if (await db.Setting.findOne({ where: { key }, transaction })) continue;
    await db.Setting.create({ key, value: { n: await maxNumber(db[name], transaction) } }, { transaction });
  }
}

async function next(modelName, transaction) {
  const { Setting, sequelize } = db;
  const model = db[modelName];
  const key = `seq:${modelName}`;
  const lock = transaction && transaction.LOCK ? transaction.LOCK.UPDATE : undefined;

  let row = await Setting.findOne({ where: { key }, transaction, lock });
  if (!row) {
    // Tashkilotdagi mavjud raqamlarning eng kattasidan davom etadi (eski "S-12" kabi raqamlar to'qnashmasin).
    // Raqamlanayotgan hujjatning o'zi hali raqamsiz ('') - hisobga kirmaydi. Tenant hook: faqat shu tashkilot.
    const start = await maxNumber(model, transaction);
    try {
      // Savepoint: bir vaqtda ikki birinchi hujjat bo'lsa, ikkinchisi butun tranzaksiyani buzmasin
      row = await sequelize.transaction({ transaction }, (sp) =>
        Setting.create({ key, value: { n: start } }, { transaction: sp }),
      );
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      row = await Setting.findOne({ where: { key }, transaction, lock });
    }
  }
  const n = (Number(row.value && row.value.n) || 0) + 1;
  await row.update({ value: { n } }, { transaction });
  return n;
}

module.exports = { next, ensureCounters };
