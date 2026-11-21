const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../../config/auth');
const { User, Role } = require('../../models');
const permissions = require('../../config/permissions');

/**
 * Tokenni tekshiradi va foydalanuvchini HAR SAFAR bazadan oladi:
 * rol o'zgarsa yoki foydalanuvchi bloklansa, token muddati tugashini kutmasdan darhol kuchga kiradi.
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

  try {
    const user = await User.findByPk(payload.id, { include: [{ model: Role, as: 'role' }] });
    if (!user || !user.active) {
      return res.status(401).json({ message: 'Token yaroqsiz yoki muddati tugagan' });
    }

    const isAdmin = !user.roleId;
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
    };
    next();
  } catch (err) {
    next(err);
  }
};
