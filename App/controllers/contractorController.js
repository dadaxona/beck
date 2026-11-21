const { Op, fn, col, where: sqlWhere } = require('sequelize');
const { User, Contractor, Category, Receipt, Sale, CashDocument, PayrollItem, SaleReturn } = require('../../models');

const blacklist = require('../services/blacklist');

const FIELDS = [
  'name', 'legalName', 'legalAddress', 'postalAddress', 'phones', 'inn', 'oked', 'vatCode',
  'representative', 'journalNumber', 'creditLimit', 'currency', 'segment', 'paymentTerm',
  'region', 'guarantor', 'barcode', 'relation', 'isOwn', 'byServices', 'byGoods', 'blacklisted',
  'serviceDiscount', 'founder', 'trackByDocuments', 'bankAccounts', 'categoryId',
];

const pick = (body) => {
  const data = {};
  for (const key of FIELDS) if (body[key] !== undefined) data[key] = body[key];
  if ('categoryId' in data && !data.categoryId) data.categoryId = null;
  if ('creditLimit' in data) data.creditLimit = Number(data.creditLimit) || 0;
  if ('paymentTerm' in data) data.paymentTerm = parseInt(data.paymentTerm, 10) || 0;
  return data;
};

const include = [{ model: Category, as: 'category', attributes: ['id', 'name'] }];

exports.list = async (req, res) => {
  const { categoryId, q, includeDeleted } = req.query;
  const where = {};

  // O'chirishga belgilanganlar faqat so'ralganda (boshqaruv ro'yxati); tanlash oynalarida chiqmaydi
  if (!includeDeleted) where.deleted = false;

  if (categoryId === 'none') where.categoryId = null;
  else if (categoryId) where.categoryId = Number(categoryId);

  if (q) {
    const like = { [Op.like]: `%${q}%` };
    where[Op.or] = [{ name: like }, { legalName: like }, { inn: like }, { phones: like }];
    // Telefon "+998 90 123 45 67" ko'rinishida saqlanadi: "901234567" deb qidirilsa ham topilsin
    const digits = String(q).replace(/\D/g, '');
    if (digits.length >= 3) {
      where[Op.or].push(sqlWhere(fn('REPLACE', col('Contractor.phones'), ' ', ''), { [Op.like]: `%${digits}%` }));
    }
  }

  const contractors = await Contractor.findAll({ where, include, order: [['name', 'ASC']] });
  res.json(contractors);
};

exports.create = async (req, res) => {
  const data = pick(req.body || {});
  if (!String(data.name || '').trim()) {
    return res.status(400).json({ message: 'Kontragent nomini kiriting' });
  }

  const created = await Contractor.create(await blacklist.apply(data, null));
  res.status(201).json(await Contractor.findByPk(created.id, { include }));
};

exports.update = async (req, res) => {
  const contractor = await Contractor.findByPk(req.params.id);
  if (!contractor) return res.status(404).json({ message: 'Kontragent topilmadi' });

  const data = pick(req.body || {});
  if ('name' in data && !String(data.name).trim()) {
    return res.status(400).json({ message: 'Kontragent nomini kiriting' });
  }

  await blacklist.apply(data, contractor);
  if (data.blacklisted && contractor.name === blacklist.RETAIL_CLIENT) {
    return res.status(400).json({ message: "Oddiy mijozni qora ro'yxatga qo'shib bo'lmaydi" });
  }

  await contractor.update(data);
  res.json(await Contractor.findByPk(contractor.id, { include }));
};

// O'chirishga belgilash (X): ro'yxatda qoladi, tanlash/qidiruvda chiqmaydi, qarz hisobotlarida qatnashmaydi
exports.remove = async (req, res) => {
  const contractor = await Contractor.findByPk(req.params.id);
  if (!contractor) return res.status(404).json({ message: 'Kontragent topilmadi' });
  if (contractor.name === blacklist.RETAIL_CLIENT) {
    return res.status(400).json({ message: "Oddiy mijozni o'chirib bo'lmaydi" });
  }
  if (await User.findOne({ where: { contractorId: contractor.id } })) {
    return res.status(409).json({ message: "Kontragentga tizim logini berilgan, avval Sozlamalarda o'chiring" });
  }
  await contractor.update({ deleted: true });
  res.json({ ok: true });
};

exports.restore = async (req, res) => {
  const contractor = await Contractor.findByPk(req.params.id);
  if (!contractor) return res.status(404).json({ message: 'Kontragent topilmadi' });
  await contractor.update({ deleted: false });
  res.json({ ok: true });
};

// Butunlay o'chirish (hujjatlarda ishlatilmagan bo'lsa)
exports.purge = async (req, res) => {
  const id = req.params.id;
  const used =
    (await Receipt.findOne({ where: { [Op.or]: [{ supplierId: id }, { driverId: id }, { loaderId: id }] } })) ||
    (await Sale.findOne({ where: { clientId: id } })) ||
    (await SaleReturn.findOne({ where: { clientId: id } })) ||
    (await PayrollItem.findOne({ where: { contractorId: id } })) ||
    (await CashDocument.findOne({
      where: { [Op.or]: [{ contractorId: id }, { fromContractorId: id }, { toContractorId: id }] },
    }));
  if (used) return res.status(409).json({ message: "Kontragent hujjatlarda ishlatilgan, o'chirib bo'lmaydi" });
  if (await User.findOne({ where: { contractorId: id } })) {
    return res.status(409).json({ message: "Kontragentga tizim logini berilgan, avval Sozlamalarda o'chiring" });
  }

  const deleted = await Contractor.destroy({ where: { id: req.params.id } });
  if (!deleted) return res.status(404).json({ message: 'Kontragent topilmadi' });
  res.json({ ok: true });
};

// Belgilangan kontragentlarni kategoriyaga biriktirish (categoryId: null -> kategoriyadan chiqarish)
exports.assign = async (req, res) => {
  const { ids, categoryId } = req.body || {};

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ message: 'Kontragentlarni belgilang' });
  }
  if (categoryId && !(await Category.findByPk(categoryId))) {
    return res.status(404).json({ message: 'Kategoriya topilmadi' });
  }

  const cat = await blacklist.ensureCategory();
  if (categoryId === cat.id) {
    if (await Contractor.findOne({ where: { id: ids, name: blacklist.RETAIL_CLIENT } })) {
      return res.status(400).json({ message: "Oddiy mijozni qora ro'yxatga qo'shib bo'lmaydi" });
    }
    return res.json({ updated: await blacklist.setMany(ids, true) });
  }

  // Qora ro'yxat kategoriyasidan chiqarilganlar ro'yxatdan ham chiqadi
  await Contractor.update({ blacklisted: false }, { where: { id: ids, categoryId: cat.id } });
  const [count] = await Contractor.update({ categoryId: categoryId || null }, { where: { id: ids } });
  res.json({ updated: count });
};

// Belgilangan kontragentlarni qora ro'yxatga qo'shish yoki chiqarish: { ids, value: true|false }
exports.blacklist = async (req, res) => {
  const { ids, value } = req.body || {};

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ message: 'Kontragentlarni belgilang' });
  }
  if (value && (await Contractor.findOne({ where: { id: ids, name: blacklist.RETAIL_CLIENT } }))) {
    return res.status(400).json({ message: "Oddiy mijozni qora ro'yxatga qo'shib bo'lmaydi" });
  }

  res.json({ updated: await blacklist.setMany(ids, !!value) });
};
