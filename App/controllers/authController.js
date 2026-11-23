const jwt = require('jsonwebtoken');
const { User, Organization } = require('../../models');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../../config/auth');
const organizations = require('../services/organizations');
const { verifyPassword, hashPassword, needsRehash } = require('../utils/password');
const { Limiter, normLogin, clientIp, loginGuard } = require('../utils/rateLimit');
const { SERVER_MODE, isLocalRequest } = require('../../config/runtime');

const publicUser = (user) => ({ id: user.id, login: user.login, name: user.name });

/**
 * Token: foydalanuvchi, tashkiloti (org) va token versiyasi (v). Parol/login o'zgarsa versiya oshadi -
 * eski tokenlar darhol yaroqsiz bo'ladi (auth middleware).
 */
const sign = (user) =>
  jwt.sign({ ...publicUser(user), org: user.organizationId, v: user.tokenVersion || 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

/*
 * Parol tanlab ko'rishdan himoya (15 daqiqa oynasi). Urinish so'rov boshida yoziladi (parallel so'rovlar ham sanaladi):
 *  - login + IP: 10 ta;  - faqat login (IP almashtirilsa ham): 30 ta;  - faqat IP (ko'p loginni sinash): 100 ta.
 */
const WINDOW = 15 * 60 * 1000;
const byLoginIp = new Limiter({ windowMs: WINDOW, max: 10 });
const byLogin = new Limiter({ windowMs: WINDOW, max: 30 });
const byIp = new Limiter({ windowMs: WINDOW, max: 100 });
const TOO_MANY = "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring";
const MAX_LOGIN = 60;

const guard = (req, login) =>
  loginGuard({ ip: clientIp(req), ipLimiter: byIp, loginIpLimiter: byLoginIp, loginLimiter: byLogin, loginKey: normLogin(login) });

exports.login = async (req, res) => {
  const { login, password } = req.body || {};

  if (!login || !password) {
    return res.status(400).json({ message: 'Login va parol kiritilishi shart' });
  }
  if (String(login).length > MAX_LOGIN || String(password).length > 200) {
    return res.status(401).json({ message: 'Login yoki parol noto\'g\'ri' });
  }
  const attempt = guard(req, login);
  if (!attempt.allowed) return res.status(429).json({ message: TOO_MANY });

  // Login butun platformada noyob: tashkilot so'ralmaydi
  const user = await User.findOne({ where: { login: String(login).trim() }, skipTenant: true });

  if (!user || !(await verifyPassword(password, user.password))) {
    return res.status(401).json({ message: 'Login yoki parol noto\'g\'ri' });
  }
  if (!user.active) {
    return res.status(403).json({ message: 'Bu foydalanuvchi bloklangan' });
  }
  const org = await Organization.findByPk(user.organizationId);
  if (!org || !org.active) {
    return res.status(403).json({ message: 'Tashkilot bloklangan' });
  }
  attempt.success();
  // Eski (ochiq saqlangan) parol - endi shifrlab qo'yiladi
  if (needsRehash(user.password)) await user.update({ password: await hashPassword(password) }, { skipTenant: true });

  res.json({ token: sign(user), user: publicUser(user) });
};

// Ro'yxatdan o'tish doim ochiq: har bir yangi mijoz o'z tashkilotini ochadi
exports.setup = async (req, res) => {
  res.json({ registration: true });
};

// Ro'yxatdan o'tishni ham cheklaymiz (bitta IP dan soatiga 20 ta tashkilot)
const registerLimit = new Limiter({ windowMs: 60 * 60 * 1000, max: 20 });

// POST /auth/register { organization, name, login, password } -> yangi tashkilot + uning administratori
exports.register = async (req, res) => {
  // Lokal dastur (Electron) mini app'lar uchun tunnel orqali internetga chiqarilgan bo'lishi mumkin: u yerda yangi
  // tashkilotni faqat shu kompyuterning o'zidan ochish mumkin (begonalar do'kon kompyuterida tashkilot ocha olmasin).
  // Server (platforma) rejimida ro'yxatdan o'tish hammaga ochiq.
  if (!SERVER_MODE && !isLocalRequest(req)) {
    return res.status(403).json({ message: "Ro'yxatdan o'tish faqat dastur o'rnatilgan kompyuterdan mumkin" });
  }
  if (!registerLimit.allow(clientIp(req))) return res.status(429).json({ message: TOO_MANY });
  const { user } = await organizations.register(req.body || {});
  res.status(201).json({ token: sign(user), user: publicUser(user) });
};

// Joriy foydalanuvchi, roli, ruxsatlari va tashkiloti (middleware bazadan to'ldirgan)
exports.me = (req, res) => {
  const { id, login, name, role, isAdmin, permissions, organization } = req.user;
  res.json({ user: { id, login, name, role, isAdmin, permissions, organization } });
};

module.exports.sign = sign;

