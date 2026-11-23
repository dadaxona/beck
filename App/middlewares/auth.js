const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES_IN, REFRESH_AFTER } = require('../../config/auth');
const { User, Role, Organization } = require('../../models');
const permissions = require('../../config/permissions');
const { runWithOrg } = require('../../database/tenant');

/**
 * Tokenni tekshiradi va foydalanuvchini HAR SAFAR bazadan oladi:
 * rol o'zgarsa yoki foydalanuvchi bloklansa, token muddati tugashini kutmasdan darhol kuchga kiradi.
 *
 * Ko'p tashkilotli rejim: so'rovning qolgan qismi foydalanuvchining TASHKILOTI kontekstida bajariladi
 * (database/tenant.js): barcha so'rovlar avtomatik shu tashkilot bilan cheklanadi.
 *
 * Doim tizimda qolish: token 1 kundan eski bo'lsa javobda yangisi qaytariladi (X-New-Token sarlavhasi).
 */
module.exports = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Avtorizatsiya talab qilinadi' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Token yaroqsiz yoki muddati tugagan' });
  }

  let user;
  let org;
  try {
    // Foydalanuvchi ID bo'yicha (tashkilot hali noma'lum) - shuning uchun skipTenant
    user = await User.findByPk(payload.id, { include: [{ model: Role, as: 'role' }], skipTenant: true });
    org = user && user.organizationId ? await Organization.findByPk(user.organizationId) : null;
  } catch (err) {
    return next(err);
  }
  if (!user || !user.active || !org) {
    return res.status(401).json({ message: 'Token yaroqsiz yoki muddati tugagan' });
  }
  // Parol/login o'zgargan (versiya oshgan) yoki token boshqa tashkilot uchun berilgan bo'lsa - yaroqsiz
  if ((payload.v || 0) !== (user.tokenVersion || 0) || (payload.org !== undefined && payload.org !== user.organizationId)) {
    return res.status(401).json({ message: 'Token yaroqsiz yoki muddati tugagan' });
  }
  if (!org.active) {
    return res.status(403).json({ message: 'Tashkilot bloklangan' });
  }

  // Administrator = tashkilot egasi (roli yo'q oddiy xodimda hech qanday ruxsat yo'q)
  const isAdmin = !!user.owner;
  // Xodimlar mini app'idan kirilgan (token src = "miniapp"): hech qachon sotuv qila olmaydi, faqat zakaz beradi
  const miniApp = payload.src === 'miniapp';
  if (miniApp && user.telegramId !== payload.tg) {
    return res.status(401).json({ message: 'Token yaroqsiz yoki muddati tugagan' });
  }
  const perms = isAdmin ? permissions.full() : permissions.sanitize(user.role ? user.role.permissions : {});
  if (miniApp) permissions.forMiniApp(perms);
  req.user = {
    id: user.id,
    login: user.login,
    name: user.name,
    roleId: user.roleId,
    role: user.role ? user.role.name : null,
    isAdmin,
    miniApp,
    permissions: perms,
    organizationId: org.id,
    organization: { id: org.id, name: org.name },
  };

  // Token eskirib qolmasin: yangisi (xuddi shu turdagi - oddiy yoki mini app) javob sarlavhasida
  if (payload.iat && Date.now() / 1000 - payload.iat > REFRESH_AFTER) {
    const { iat, exp, ...rest } = payload; // eslint-disable-line no-unused-vars
    res.setHeader(
      'X-New-Token',
      jwt.sign({ ...rest, org: user.organizationId, v: user.tokenVersion || 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
    );
  }

  runWithOrg(org.id, () => next());
};
