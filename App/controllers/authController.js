const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../../config/auth');

const publicUser = (user) => ({ id: user.id, login: user.login, name: user.name });

const sign = (user) =>
  jwt.sign(publicUser(user), JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

exports.login = async (req, res) => {
  const { login, password } = req.body || {};

  if (!login || !password) {
    return res.status(400).json({ message: 'Login va parol kiritilishi shart' });
  }

  const user = await User.findOne({ where: { login } });

  if (!user || user.password !== password) {
    return res.status(401).json({ message: 'Login yoki parol noto\'g\'ri' });
  }
  if (!user.active) {
    return res.status(403).json({ message: 'Bu foydalanuvchi bloklangan' });
  }

  res.json({ token: sign(user), user: publicUser(user) });
};

// Ro'yxatdan o'tish faqat birinchi marta (hali foydalanuvchi yo'q): u administrator bo'ladi.
// Keyingi foydalanuvchilar Sozlamalar oynasida rol bilan qo'shiladi.
exports.setup = async (req, res) => {
  res.json({ registration: (await User.count()) === 0 });
};

exports.register = async (req, res) => {
  const { name, login, password } = req.body || {};

  if (!name || !login || !password) {
    return res.status(400).json({ message: 'Ism, login va parol kiritilishi shart' });
  }

  if ((await User.count()) > 0) {
    return res.status(403).json({
      message: "Ro'yxatdan o'tish yopiq. Yangi foydalanuvchini Sozlamalar oynasida qo'shing",
    });
  }

  const exists = await User.findOne({ where: { login } });
  if (exists) {
    return res.status(409).json({ message: 'Bu login band' });
  }

  const user = await User.create({ name, login, password });

  res.status(201).json({ token: sign(user), user: publicUser(user) });
};

// Joriy foydalanuvchi, roli va ruxsatlari (middleware bazadan to'ldirgan)
exports.me = (req, res) => {
  const { id, login, name, role, isAdmin, permissions } = req.user;
  res.json({ user: { id, login, name, role, isAdmin, permissions } });
};
