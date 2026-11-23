const { sequelize, CashDocument, CashDesk, User } = require('../../models');
const numbering = require('../services/numbering');
const currencies = require('../services/currencies');
const { assertNonNegative } = require('../services/cashbook');
const { today } = require('../utils/date');

/*
 * Investitsiya (Pul → Investitsiya): tashqaridan kiritilgan pul (egasi yoki sherik qo'shgan mablag').
 * Hech kimga biriktirilmaydi (kontragentsiz), sotuv emas: to'g'ridan-to'g'ri tanlangan kassaga tushadi.
 *
 * Saqlanishi: kassa hujjati (CashDocument) - type "income", partyType "investment". Shuning uchun:
 *  - kassa qoldig'iga qo'shiladi (cashbook.deskBalance);
 *  - qarzlarga ta'sir qilmaydi (kontragent yo'q), foyda/daromad hisobiga kirmaydi (moliya hisobotida alohida qator);
 *  - Kassa jurnalida ko'rinadi, lekin faqat shu bo'limda o'zgartiriladi.
 */
const fail = (status, message) => Object.assign(new Error(message), { status });
const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

const include = [
  { model: CashDesk, as: 'cashDesk', attributes: ['id', 'name'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
];
const WHERE = { partyType: 'investment' };

const view = (d) => ({
  id: d.id,
  number: d.number,
  date: d.date,
  createdAt: d.createdAt,
  amount: d.cashAmount,
  currency: d.currency,
  comment: d.comment,
  deleted: d.deleted,
  cashDesk: d.cashDesk ? { id: d.cashDesk.id, name: d.cashDesk.name } : null,
  user: d.user ? { id: d.user.id, name: d.user.name } : null,
});

async function find(id) {
  const doc = await CashDocument.findOne({ where: { id: Number(id), ...WHERE }, include });
  if (!doc) throw fail(404, 'Hujjat topilmadi');
  return doc;
}

// GET /investments - ro'yxat va valyutalar bo'yicha jami (o'chirilganlar jamiga kirmaydi)
exports.list = async (req, res) => {
  const rows = await CashDocument.findAll({ where: WHERE, include, order: [['date', 'DESC'], ['id', 'DESC']] });
  const totals = {};
  for (const d of rows) if (!d.deleted) totals[d.currency] = round((totals[d.currency] || 0) + d.cashAmount);
  res.json({ rows: rows.map(view), totals });
};

// POST /investments { amount, cashDeskId, currency?, comment?, date? }
exports.create = async (req, res) => {
  const b = req.body || {};
  const amount = round(b.amount);
  if (!(amount > 0)) throw fail(400, 'Summani kiriting');
  if (!b.cashDeskId) throw fail(400, "To'lov turini (kassani) tanlang");
  const currency = b.currency || 'UZS';
  const rate = await currencies.assertKnown(currency);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : today();

  const id = await sequelize.transaction(async (t) => {
    const doc = await CashDocument.create(
      {
        type: 'income',
        partyType: 'investment',
        number: '',
        date,
        posted: true,
        currency,
        accountCurrency: currency,
        rate,
        accountRate: rate,
        cashAmount: amount,
        accountAmount: amount,
        coef1: 1,
        coef2: 1,
        comment: String(b.comment || '').trim().slice(0, 255),
        cashDeskId: Number(b.cashDeskId),
        userId: req.user.id,
      },
      { transaction: t },
    );
    await doc.update({ number: `IV-${await numbering.next('CashDocument', t)}` }, { transaction: t });
    return doc.id;
  });
  res.status(201).json(view(await find(id)));
};

// DELETE /investments/:id - o'chirishga belgilash: pul kassadan chiqadi (kassa manfiyga tushmasligi kerak)
exports.remove = async (req, res) => {
  const doc = await find(req.params.id);
  if (doc.deleted) return res.json(view(doc));
  await sequelize.transaction(async (t) => {
    await doc.update({ posted: false, deleted: true }, { transaction: t });
    await assertNonNegative([{ deskId: doc.cashDeskId, currency: doc.currency }], t);
  });
  res.json(view(await find(doc.id)));
};

// POST /investments/:id/restore - qayta kuchga kiradi (pul yana kassaga)
exports.restore = async (req, res) => {
  const doc = await find(req.params.id);
  await doc.update({ deleted: false, posted: true });
  res.json(view(await find(doc.id)));
};

// DELETE /investments/:id/purge - butunlay o'chirish (faqat belgilangani)
exports.purge = async (req, res) => {
  const doc = await find(req.params.id);
  if (!doc.deleted) throw fail(400, "Avval o'chirishga belgilang");
  await doc.destroy();
  res.json({ ok: true });
};
