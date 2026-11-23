const { sequelize, Role, User } = require('../../models');
const { SECTIONS, sanitize } = require('../../config/permissions');

/** Administrator bo'lmagan foydalanuvchi faqat o'zida bor ruxsatlarni bera oladi */
function assertGrantable(req, permissions) {
  if (req.user.isAdmin) return;
  for (const [section, actions] of Object.entries(permissions)) {
    const own = req.user.permissions[section] || [];
    if (actions.some((a) => !own.includes(a))) {
      throw Object.assign(new Error("O'zingizda yo'q ruxsatni bera olmaysiz"), { status: 403 });
    }
  }
}

const view = (role, users = 0) => ({
  id: role.id,
  name: role.name,
  permissions: sanitize(role.permissions),
  users,
});

// Rollar ro'yxati va ruxsatlar katalogi (qaysi bo'limda qanday amallar bor)
exports.list = async (req, res) => {
  const [roles, counts] = await Promise.all([
    Role.findAll({ order: [['name', 'ASC']] }),
    User.count({ group: ['roleId'] }),
  ]);
  const countOf = (id) => counts.find((c) => c.roleId === id)?.count || 0;

  res.json({
    catalog: Object.entries(SECTIONS).map(([key, actions]) => ({ key, actions })),
    roles: roles.map((r) => view(r, countOf(r.id))),
  });
};

exports.create = async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Rol nomini kiriting' });
  if (await Role.findOne({ where: { name } })) {
    return res.status(409).json({ message: 'Bunday rol mavjud' });
  }

  const permissions = sanitize(req.body?.permissions);
  assertGrantable(req, permissions);
  const role = await Role.create({ name, permissions });
  res.status(201).json(view(role));
};

/** Administrator bo'lmagan foydalanuvchi faqat ruxsatlari o'zinikidan keng BO'LMAGAN rolni o'zgartira/o'chira oladi */
function assertManageable(req, role) {
  if (req.user.isAdmin) return;
  try {
    assertGrantable(req, sanitize(role.permissions));
  } catch {
    throw Object.assign(new Error("Sizdan ko'proq ruxsati bor rolni o'zgartira olmaysiz"), { status: 403 });
  }
}

exports.update = async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) return res.status(404).json({ message: 'Rol topilmadi' });
  assertManageable(req, role);
  if (!req.user.isAdmin && role.id === req.user.roleId) {
    return res.status(403).json({ message: "O'z rolingizni o'zgartira olmaysiz" });
  }

  const data = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ message: 'Rol nomini kiriting' });
    const same = await Role.findOne({ where: { name } });
    if (same && same.id !== role.id) return res.status(409).json({ message: 'Bunday rol mavjud' });
    data.name = name;
  }
  if (req.body?.permissions !== undefined) {
    data.permissions = sanitize(req.body.permissions);
    assertGrantable(req, data.permissions);
  }

  await role.update(data);
  res.json(view(role, await User.count({ where: { roleId: role.id } })));
};

exports.remove = async (req, res) => {
  const role = await Role.findByPk(req.params.id);
  if (!role) return res.status(404).json({ message: 'Rol topilmadi' });
  assertManageable(req, role);
  if (!req.user.isAdmin && role.id === req.user.roleId) {
    return res.status(403).json({ message: "O'z rolingizni o'zgartira olmaysiz" });
  }

  // Tekshirish va o'chirish bitta tranzaksiyada (rol qulflanadi): shu paytda boshqa so'rov rolni biriktira olmaydi
  await sequelize.transaction(async (t) => {
    await Role.findByPk(role.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (await User.count({ where: { roleId: role.id }, transaction: t })) {
      throw Object.assign(new Error("Rol foydalanuvchilarga biriktirilgan, o'chirib bo'lmaydi"), { status: 409 });
    }
    await role.destroy({ transaction: t });
  });
  res.json({ ok: true });
};
