const currencies = require('../services/currencies');

// GET /currencies - barcha valyutalar va kurslar (UZS birinchi). Tizimga kirgan har kimga ochiq (narxlarni o'girish uchun).
exports.list = async (req, res) => {
  res.json(await currencies.list());
};

// POST /currencies { code, rate } - "1 USD = 12 800 UZS"
exports.create = async (req, res) => {
  await currencies.add(req.body || {});
  res.status(201).json(await currencies.list());
};

// PUT /currencies/:code { rate }
exports.update = async (req, res) => {
  await currencies.update(String(req.params.code).toUpperCase(), req.body || {});
  res.json(await currencies.list());
};

// DELETE /currencies/:code
exports.remove = async (req, res) => {
  await currencies.remove(String(req.params.code).toUpperCase());
  res.json(await currencies.list());
};
