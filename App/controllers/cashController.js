const { Op } = require('sequelize');
const {
  sequelize,
  CashDesk,
  CashArticle,
  CashDocument,
  Receipt,
  Contractor,
  User,
} = require('../../models');

const ledger = require('../services/ledger');
const { deskBalance, assertNonNegative } = require('../services/cashbook');

const TYPES = ['income', 'expense', 'transfer'];
const PREFIX = { income: 'KK', expense: 'KC', transfer: 'MO' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v) || 0;
const round = (v) => Math.round(v * 100) / 100;
const { today } = require('../utils/date');

const include = [
  { model: CashDesk, as: 'cashDesk', attributes: ['id', 'name'] },
  { model: Contractor, as: 'contractor', attributes: ['id', 'name'] },
  { model: Contractor, as: 'fromContractor', attributes: ['id', 'name'] },
  { model: Contractor, as: 'toContractor', attributes: ['id', 'name'] },
  { model: CashArticle, as: 'article', attributes: ['id', 'name'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
];

// ---------------------------------------------------------------- hujjatlar

function normalize(b, type) {
  const currency = b.currency || 'UZS';
  const accountCurrency = b.accountCurrency || 'UZS';
  const same = currency === accountCurrency;
  const coef1 = same ? 1 : num(b.coef1) || 1;
  const coef2 = same ? 1 : num(b.coef2) || 1;
  const k = coef1 / coef2;

  let cashAmount;
  let accountAmount;
  if (type === 'income') {
    accountAmount = num(b.accountAmount);
    cashAmount = accountAmount / k;
  } else {
    cashAmount = num(b.cashAmount);
    accountAmount = cashAmount * k;
  }
  return { currency, accountCurrency, coef1, coef2, cashAmount: round(cashAmount), accountAmount: round(accountAmount) };
}

/** Kirim hujjatining "To'langan summa"sidan yaratilgan kassa hujjati faqat kirim orqali o'zgaradi */
async function assertNotLinked(doc) {
  const receipt = await Receipt.findOne({ where: { cashDocumentId: doc.id }, attributes: ['number'] });
  if (receipt) {
    throw fail(400, `Bu to'lov ${receipt.number} kirim hujjatidan avtomatik yaratilgan. Uni kirim hujjatida o'zgartiring`);
  }
}

async function save(req, existing) {
  if (existing) await assertNotLinked(existing);
  if (existing && existing.deleted) throw fail(400, "O'chirilgan hujjatni o'zgartirib bo'lmaydi. Avval o'chirish belgisini bekor qiling");
  const b = req.body || {};
  const type = existing ? existing.type : b.type;
  if (!TYPES.includes(type)) throw fail(400, "Hujjat turi noto'g'ri");

  const n = normalize(b, type);
  if (!(n.cashAmount > 0) || !(n.accountAmount > 0)) throw fail(400, 'Summani kiriting');

  const data = {
    ...n,
    date: b.date || today(),
    comment: b.comment || '',
    posted: !!b.post,
    cashDeskId: null,
    contractorId: null,
    fromContractorId: null,
    toContractorId: null,
    articleId: null,
    terminal: false,
    partyType: 'contractor',
  };

  if (type === 'transfer') {
    if (!b.fromContractorId || !b.toContractorId) throw fail(400, 'Ikkala kontragentni tanlang');
    if (Number(b.fromContractorId) === Number(b.toContractorId)) throw fail(400, 'Kontragentlar bir xil bo\'lishi mumkin emas');
    data.fromContractorId = b.fromContractorId;
    data.toContractorId = b.toContractorId;
  } else {
    if (!b.cashDeskId) throw fail(400, 'Kassani tanlang');
    data.cashDeskId = b.cashDeskId;
    data.articleId = b.articleId || null;
    data.partyType = ['employee', 'other'].includes(b.partyType) ? b.partyType : 'contractor'; // contractor | employee | other
    if (data.partyType !== 'other') {
      if (!b.contractorId) throw fail(400, 'Kontragentni tanlang');
      data.contractorId = b.contractorId;
    }
    data.terminal = type === 'income' && !!b.terminal;
  }

  const id = await sequelize.transaction(async (t) => {
    const pairs = [{ deskId: data.cashDeskId, currency: data.currency }];
    if (existing) pairs.push({ deskId: existing.cashDeskId, currency: existing.currency });

    let doc = existing;
    if (doc) {
      await doc.update({ ...data, number: b.number || doc.number }, { transaction: t });
    } else {
      doc = await CashDocument.create({ ...data, type, number: b.number || '', userId: req.user.id }, { transaction: t });
      if (!doc.number) await doc.update({ number: `${PREFIX[type]}-${doc.id}` }, { transaction: t });
    }

    await assertNonNegative(pairs, t);
    return doc.id;
  });

  return CashDocument.findByPk(id, { include });
}

exports.get = async (req, res) => {
  const doc = await CashDocument.findByPk(req.params.id, { include });
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(doc);
};

exports.list = async (req, res) => {
  const { cashDeskId, currency, date } = req.query;
  const where = {};
  if (cashDeskId) where.cashDeskId = Number(cashDeskId);
  if (currency) where.currency = currency;
  if (date) where.date = date;

  const [rows, balance] = await Promise.all([
    CashDocument.findAll({ where, include, order: [['date', 'DESC'], ['id', 'DESC']] }),
    deskBalance(cashDeskId ? Number(cashDeskId) : null, currency || 'UZS'),
  ]);
  res.json({ rows, balance, currency: currency || 'UZS' });
};

exports.balance = async (req, res) => {
  const { cashDeskId, currency } = req.query;
  res.json({ balance: await deskBalance(cashDeskId ? Number(cashDeskId) : null, currency || 'UZS') });
};

exports.contractorBalance = async (req, res) => {
  const currency = req.query.currency || 'UZS';
  res.json({ balance: await ledger.contractorBalance(Number(req.params.id), currency), currency });
};

// Barcha kontragentlar balansi: { balances: { [id]: balans } }
exports.balances = async (req, res) => {
  const currency = req.query.currency || 'UZS';
  res.json({ balances: await ledger.balancesByContractor(currency), currency });
};

// Hisob-kitoblar kitobi (akt sverka)
exports.ledger = async (req, res) => {
  const currency = req.query.currency || 'UZS';
  const rows = await ledger.contractorLedger(Number(req.params.id), currency, req.query.to || null);
  res.json({ rows, balance: rows.length ? rows[rows.length - 1].balance : 0, currency });
};

exports.create = async (req, res) => {
  res.status(201).json(await save(req, null));
};

exports.update = async (req, res) => {
  const doc = await CashDocument.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(await save(req, doc));
};

// O'chirishga belgilash (X): kassa qoldig'i va qarzga ta'siri bekor bo'ladi, hujjat ro'yxatda qoladi
exports.remove = async (req, res) => {
  const doc = await CashDocument.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  if (doc.deleted) return res.json({ ok: true });
  await assertNotLinked(doc);

  await sequelize.transaction(async (t) => {
    await doc.update({ posted: false, deleted: true }, { transaction: t });
    await assertNonNegative([{ deskId: doc.cashDeskId, currency: doc.currency }], t);
  });
  res.json({ ok: true });
};

exports.restore = async (req, res) => {
  const doc = await CashDocument.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  await doc.update({ deleted: false });
  res.json({ ok: true });
};

// Butunlay o'chirish
exports.purge = async (req, res) => {
  const doc = await CashDocument.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  await assertNotLinked(doc);

  await sequelize.transaction(async (t) => {
    await doc.destroy({ transaction: t });
    await assertNonNegative([{ deskId: doc.cashDeskId, currency: doc.currency }], t);
  });
  res.json({ ok: true });
};

// ---------------------------------------------------------------- kataloglar (kassa, modda)

const catalog = (Model) => ({
  list: async (req, res) => res.json(await Model.findAll({ order: [['name', 'ASC']] })),
  create: async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Nomini kiriting' });
    if (await Model.findOne({ where: { name } })) return res.status(409).json({ message: 'Bunday nom mavjud' });
    res.status(201).json(await Model.create({ name }));
  },
});

exports.desks = catalog(CashDesk);
exports.articles = catalog(CashArticle);
