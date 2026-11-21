const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Product, ProductCategory, User, Contractor } = require('../../models');
const { JWT_SECRET } = require('../../config/auth');
const telegram = require('../services/telegram');
const orders = require('../services/orders');
const receiptSettings = require('../services/receiptSettings');
const { money } = require('../utils/money');
const currencies = require('../services/currencies');

const fail = (status, message) => Object.assign(new Error(message), { status });
const initDataOf = (req) => req.headers['x-telegram-init-data'] || (req.body && req.body.initData) || '';

const STATUS_TEXT = { new: 'Yangi', seen: "Ko'rib chiqilmoqda", sold: 'Bajarildi', cancelled: 'Bekor qilingan' };

/* ======================= Mijozlar mini app'i (internet magazin) ======================= */

/** Mijozni Telegram imzosi bo'yicha aniqlaydi (zakaz berish va o'z zakazlarini ko'rish uchun) */
async function clientUser(req) {
  const s = await telegram.config();
  if (!s.client.enabled || !s.client.token) throw fail(503, 'Internet magazin hozircha yopiq');
  const data = telegram.verifyInitData(initDataOf(req), s.client.token);
  if (!data) throw fail(401, "Do'konni Telegram bot orqali oching");
  return data.user;
}

const shopName = async () => {
  const s = await telegram.config();
  if (s.shopName) return s.shopName;
  const { layout } = await receiptSettings.get();
  return layout.shopName.trim() || "Do'kon";
};

// GET /mini/shop/info - do'kon nomi va kategoriyalar
exports.shopInfo = async (req, res) => {
  const s = await telegram.config();
  const categories = await ProductCategory.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] });
  res.json({ name: await shopName(), open: !!(s.client.enabled && s.client.token), categories });
};

// GET /mini/shop/products - sotuvdagi tovarlar (faqat sotish narxi; tannarx/diller narxi ko'rsatilmaydi)
exports.shopProducts = async (req, res) => {
  const products = await Product.findAll({
    where: { deleted: false, retailPrice: { [Op.gt]: 0 } },
    attributes: ['id', 'name', 'retailPrice', 'currency', 'unit', 'image', 'categoryId'],
    order: [['name', 'ASC']],
  });
  const stock = await orders.stockMap();
  const rates = await currencies.rates();
  // Do'konda narx doim so'mda (tovar USD da bo'lsa hozirgi kurs bo'yicha)
  const uzs = (p) => (!p.currency || p.currency === 'UZS' ? p.retailPrice : Math.round(p.retailPrice * (rates[p.currency] || 1) * 100) / 100);
  res.json(
    products.map((p) => {
      const qty = stock.get(p.id) || 0;
      return { id: p.id, name: p.name, price: uzs(p), unit: p.unit, image: p.image, categoryId: p.categoryId, available: qty > 0, stock: Math.max(0, qty) };
    }),
  );
};

// Oddiy himoya: bir mijoz soatiga ko'pi bilan 15 ta zakaz
const recent = new Map();
function rateLimit(key) {
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 3600_000);
  if (list.length >= 15) throw fail(429, "Juda ko'p zakaz. Birozdan keyin urinib ko'ring");
  list.push(now);
  recent.set(key, list);
}

// POST /mini/shop/orders { name, phone, address, comment, items: [{ productId, quantity }] }
exports.shopOrder = async (req, res) => {
  const user = await clientUser(req);
  rateLimit(String(user.id));
  const b = req.body || {};
  const order = await orders.create({
    source: 'client',
    customerName: b.name,
    phone: b.phone,
    address: b.address,
    comment: b.comment,
    items: (Array.isArray(b.items) ? b.items : []).map((i) => ({ productId: i.productId, quantity: i.quantity })),
    telegramId: user.id,
    telegramName: [user.first_name, user.last_name].filter(Boolean).join(' ') + (user.username ? ` (@${user.username})` : ''),
  });
  const lines = order.items.map((i) => `• ${i.product ? i.product.name : ''} × ${i.quantity} = ${money(i.sum)}`).join('\n');
  telegram.notify(
    'client',
    user.id,
    `✅ Zakazingiz qabul qilindi: ${order.number}\n\n${lines}\n\nJami: ${money(order.total)} ${order.currency}\n` +
      `Manzil: ${order.address}\nTelefon: ${order.phone}\n\nTez orada siz bilan bog'lanamiz.`,
  );
  res.status(201).json({ id: order.id, number: order.number, total: order.total, currency: order.currency });
};

// GET /mini/shop/orders - mijozning o'z zakazlari
exports.shopMyOrders = async (req, res) => {
  const user = await clientUser(req);
  const rows = await orders.list({ source: 'client', telegramId: String(user.id) }, 50);
  res.json(
    rows.map((o) => ({
      id: o.id,
      number: o.number,
      date: o.date,
      createdAt: o.createdAt,
      status: o.status,
      statusText: STATUS_TEXT[o.status] || o.status,
      total: o.total,
      currency: o.currency,
      address: o.address,
      items: o.items.map((i) => ({ name: i.product ? i.product.name : '', image: i.product ? i.product.image : null, quantity: i.quantity, price: i.price, sum: i.sum })),
    })),
  );
};

/* ======================= Xodimlar mini app'i ======================= */

async function employeeTg(req) {
  const s = await telegram.config();
  if (!s.employee.enabled || !s.employee.token) throw fail(503, 'Xodimlar mini app\'i o\'chirilgan');
  const data = telegram.verifyInitData(initDataOf(req), s.employee.token);
  if (!data) throw fail(401, 'Mini app\'ni Telegram bot orqali oching');
  return data.user;
}

const signMini = (user, tgId) =>
  jwt.sign({ id: user.id, login: user.login, name: user.name, src: 'miniapp', tg: String(tgId) }, JWT_SECRET, { expiresIn: '30d' });

// POST /mini/agent/session { initData } - Telegram akkaunti bog'langan bo'lsa darhol kiradi
exports.agentSession = async (req, res) => {
  const tg = await employeeTg(req);
  const user = await User.findOne({ where: { telegramId: String(tg.id) } });
  if (!user) return res.json({ linked: false, telegram: { id: tg.id, name: tg.first_name || '' } });
  if (!user.active) throw fail(403, 'Bu foydalanuvchi bloklangan');
  res.json({ linked: true, token: signMini(user, tg.id) });
};

// POST /mini/agent/login { initData, login, password } - birinchi marta: Telegram akkauntni foydalanuvchiga bog'lash
exports.agentLogin = async (req, res) => {
  const tg = await employeeTg(req);
  const { login, password } = req.body || {};
  if (!login || !password) throw fail(400, 'Login va parol kiritilishi shart');
  const user = await User.findOne({ where: { login: String(login).trim() } });
  if (!user || user.password !== password) throw fail(401, "Login yoki parol noto'g'ri");
  if (!user.active) throw fail(403, 'Bu foydalanuvchi bloklangan');
  // Bitta Telegram akkaunt faqat bitta foydalanuvchiga bog'lanadi
  await User.update({ telegramId: null }, { where: { telegramId: String(tg.id), id: { [Op.ne]: user.id } } });
  await user.update({ telegramId: String(tg.id) });
  res.json({ linked: true, token: signMini(user, tg.id) });
};

// GET /mini/agent/me (token bilan) - xodimning kontragent kartochkasi: zakaz formasini oldindan to'ldirish uchun
exports.agentMe = async (req, res) => {
  const user = await User.findByPk(req.user.id, {
    include: [{ model: Contractor, as: 'contractor', attributes: ['id', 'name', 'phones', 'legalAddress', 'postalAddress'] }],
  });
  const c = user && user.contractor;
  res.json({
    contractor: c
      ? { id: c.id, name: c.name, phone: String(c.phones || '').split(/[,;]/)[0].trim(), address: (c.postalAddress || c.legalAddress || '').trim() }
      : null,
  });
};

// POST /mini/agent/logout (token bilan) - Telegram akkauntni foydalanuvchidan uzish
exports.agentLogout = async (req, res) => {
  await User.update({ telegramId: null }, { where: { id: req.user.id } });
  res.json({ ok: true });
};
