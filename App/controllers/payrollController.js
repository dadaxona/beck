const { sequelize, Payroll, PayrollItem, Contractor, User } = require('../../models');
const numbering = require('../services/numbering');
const currencies = require('../services/currencies');

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => Number(v) || 0;
const { today } = require('../utils/date');

const include = [
  { model: User, as: 'user', attributes: ['id', 'name'] },
  {
    model: PayrollItem,
    as: 'items',
    include: [{ model: Contractor, as: 'contractor', attributes: ['id', 'name'] }],
  },
];

const load = (id) =>
  Payroll.findByPk(id, { include, order: [[{ model: PayrollItem, as: 'items' }, 'id', 'ASC']] });

async function save(req, existing) {
  const b = req.body || {};
  if (existing && existing.deleted) throw fail(400, "O'chirilgan hujjatni o'zgartirib bo'lmaydi. Avval o'chirish belgisini bekor qiling");

  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({
    contractorId: i.contractorId,
    amount: num(i.amount),
  }));
  if (items.some((i) => !i.contractorId)) throw fail(400, 'Barcha qatorlarda xodim tanlanishi kerak');
  if (items.some((i) => i.amount <= 0)) throw fail(400, "Summa 0 dan katta bo'lishi kerak");
  if (b.post && !items.length) throw fail(400, "Xodimlarni qo'shing");

  const period = /^\d{4}-\d{2}$/.test(b.period || '') ? b.period : today().slice(0, 7);

  const currency = b.currency || 'UZS';
  const currentRate = await currencies.assertKnown(currency);
  const rate = existing && existing.currency === currency && existing.rate ? existing.rate : currentRate;

  const id = await sequelize.transaction(async (t) => {
    const data = {
      date: b.date || today(),
      period,
      currency,
      rate,
      comment: b.comment || '',
      total: items.reduce((s, i) => s + i.amount, 0),
      posted: !!b.post,
    };

    let doc = existing;
    if (doc) {
      await PayrollItem.destroy({ where: { payrollId: doc.id }, transaction: t });
      await doc.update({ ...data, number: b.number || doc.number }, { transaction: t });
    } else {
      doc = await Payroll.create({ ...data, number: b.number || '', userId: req.user.id }, { transaction: t });
      if (!doc.number) await doc.update({ number: `OH-${await numbering.next('Payroll', t)}` }, { transaction: t });
    }
    await PayrollItem.bulkCreate(items.map((i) => ({ ...i, payrollId: doc.id })), { transaction: t });
    return doc.id;
  });

  return load(id);
}

exports.get = async (req, res) => {
  const doc = await load(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(doc);
};

exports.list = async (req, res) => {
  res.json(await Payroll.findAll({ include, order: [['date', 'DESC'], ['id', 'DESC']] }));
};

exports.create = async (req, res) => {
  res.status(201).json(await save(req, null));
};

exports.update = async (req, res) => {
  const doc = await Payroll.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  res.json(await save(req, doc));
};

// O'chirishga belgilash (X): hisoblash bekor bo'ladi (xodim qarzi kamayadi), hujjat ro'yxatda qoladi
exports.remove = async (req, res) => {
  const doc = await Payroll.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  await doc.update({ posted: false, deleted: true });
  res.json({ ok: true });
};

exports.restore = async (req, res) => {
  const doc = await Payroll.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });
  await doc.update({ deleted: false });
  res.json({ ok: true });
};

// Butunlay o'chirish
exports.purge = async (req, res) => {
  const doc = await Payroll.findByPk(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Hujjat topilmadi' });

  await sequelize.transaction(async (t) => {
    await PayrollItem.destroy({ where: { payrollId: doc.id }, transaction: t });
    await doc.destroy({ transaction: t });
  });
  res.json({ ok: true });
};
