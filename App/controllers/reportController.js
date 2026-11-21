const { Contractor, Category } = require('../../models');
const ledger = require('../services/ledger');
const finance = require('../services/finance');

const fail = (status, message) => Object.assign(new Error(message), { status });

// Akt sverka: ?contractorId=&from=YYYY-MM-DD&to=YYYY-MM-DD&currency=UZS
exports.reconciliation = async (req, res) => {
  const { contractorId, from, to } = req.query;
  const currency = req.query.currency || 'UZS';
  if (!contractorId) throw fail(400, 'Kontragentni tanlang');

  const contractor = await Contractor.findByPk(Number(contractorId), { attributes: ['id', 'name', 'inn'] });
  if (!contractor) throw fail(404, 'Kontragent topilmadi');

  const statement = await ledger.contractorStatement(contractor.id, currency, from || null, to || null);
  res.json({ contractor, currency, from: from || null, to: to || null, ...statement });
};

// Moliya hisoboti: ?currency=UZS&from=YYYY-MM-DD&to=YYYY-MM-DD
exports.finance = async (req, res) => {
  res.json(await finance.financeReport(req.query.currency || 'UZS', req.query.from || null, req.query.to || null));
};

// Dashboard: ?currency=UZS
exports.dashboard = async (req, res) => {
  res.json(await finance.dashboard(req.query.currency || 'UZS'));
};

// Debitorlar / Kreditorlar: ?type=debtors|creditors&date=YYYY-MM-DD&currency=UZS&categoryId=
// Debitor = kontragent bizga qarzdor (balans < 0), Kreditor = biz qarzdormiz (balans > 0).
exports.debtors = async (req, res) => {
  const type = req.query.type === 'creditors' ? 'creditors' : 'debtors';
  const currency = req.query.currency || 'UZS';
  const date = req.query.date || null;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;

  const balances = await ledger.balancesByContractor(currency, date);
  const ids = Object.keys(balances)
    .map(Number)
    .filter((id) => (type === 'debtors' ? balances[id] < -0.005 : balances[id] > 0.005));

  const where = { id: ids };
  if (categoryId) where.categoryId = categoryId;
  const contractors = ids.length
    ? await Contractor.findAll({
        where,
        attributes: ['id', 'name', 'inn', 'guarantor'],
        include: [{ model: Category, as: 'category', attributes: ['id', 'name'] }],
      })
    : [];

  const rows = contractors
    .map((c) => ({
      id: c.id,
      name: c.name,
      inn: c.inn,
      guarantor: c.guarantor,
      category: c.category ? c.category.name : '',
      amount: Math.abs(balances[c.id]),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  res.json({ type, currency, date, rows, total });
};
