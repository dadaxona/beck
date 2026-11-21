const settings = require('../services/telegramSettings');
const telegram = require('../services/telegram');

// GET /telegram/settings - sozlamalar (tokenlar yashirilgan) va botlar holati
exports.get = async (req, res) => {
  res.json({ settings: settings.publicView(await settings.get()), status: telegram.status() });
};

// PUT /telegram/settings - saqlash va botlarni qayta ulash (mini app tugmasi avtomatik o'rnatiladi)
exports.save = async (req, res) => {
  const saved = await settings.save(req.body || {});
  await telegram.apply({ force: true });
  // Bot ulanishi uchun bir oz kutamiz: holat (username / xato) darhol ko'rinsin
  await new Promise((r) => setTimeout(r, 2500));
  res.json({ settings: settings.publicView(saved), status: telegram.status() });
};

// GET /telegram/status
exports.status = async (req, res) => {
  res.json({ status: telegram.status() });
};
