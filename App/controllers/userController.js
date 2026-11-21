const { User, Role, Contractor } = require('../../models');

const include = [
  { model: Contractor, as: 'contractor', attributes: ['id', 'name'] },
  { model: Role, as: 'role', attributes: ['id', 'name'] },
];

// Parol ro'yxatda ko'rsatilmaydi (tahrirlashda bo'sh qoldirilsa o'zgarmaydi)
const view = (u) => ({
  id: u.id,
  login: u.login,
  name: u.name,
  active: u.active,
  contractorId: u.contractorId,
  contractor: u.contractor ? { id: u.contractor.id, name: u.contractor.name } : null,
  roleId: u.roleId,
  role: u.role ? { id: u.role.id, name: u.role.name } : null,
  isAdmin: !u.roleId,
});

const fail = (status, message) => Object.assign(new Error(message), { status });

// Administratorni (rolsiz foydalanuvchi) faqat administrator o'zgartira oladi
const guardAdmin = (req, target) => {
  if (!target.roleId && !req.user.isAdmin) throw fail(403, "Administratorni faqat administrator o'zgartira oladi");
};

async function checkContractor(contractorId, exceptUserId = null) {
  const contractor = await Contractor.findByPk(contractorId);
  if (!contractor) throw fail(404, 'Kontragent topilmadi');
  const linked = await User.findOne({ where: { contractorId: contractor.id } });
  if (linked && linked.id !== exceptUserId) {
    throw fail(409, 'Bu kontragentga login allaqachon berilgan');
  }
  return contractor;
}

async function checkLogin(login, exceptUserId = null) {
  if (!login) throw fail(400, 'Login kiritilishi shart');
  const same = await User.findOne({ where: { login } });
  if (same && same.id !== exceptUserId) throw fail(409, 'Bu login band');
}

async function checkRole(roleId) {
  if (!roleId) throw fail(400, 'Rolni tanlang');
  if (!(await Role.findByPk(roleId))) throw fail(404, 'Rol topilmadi');
}

exports.list = async (req, res) => {
  const users = await User.findAll({ include, order: [['name', 'ASC']] });
  res.json(users.map(view));
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const login = String(body.login || '').trim();
  const password = String(body.password || '');

  if (!body.contractorId) throw fail(400, 'Xodimni (kontragentni) tanlang');
  const contractor = await checkContractor(Number(body.contractorId));
  await checkLogin(login);
  if (!password) throw fail(400, 'Parolni kiriting');
  await checkRole(body.roleId);

  const created = await User.create({
    login,
    password,
    name: contractor.name,
    contractorId: contractor.id,
    roleId: Number(body.roleId),
    active: body.active === undefined ? true : !!body.active,
  });
  res.status(201).json(view(await User.findByPk(created.id, { include })));
};

exports.update = async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw fail(404, 'Foydalanuvchi topilmadi');
  guardAdmin(req, user);

  const body = req.body || {};
  const self = user.id === req.user.id;
  const data = {};

  if (body.contractorId !== undefined && Number(body.contractorId) !== user.contractorId) {
    if (!body.contractorId) throw fail(400, 'Xodimni (kontragentni) tanlang');
    data.name = (await checkContractor(Number(body.contractorId), user.id)).name;
    data.contractorId = Number(body.contractorId);
  }
  if (body.login !== undefined) {
    const login = String(body.login).trim();
    await checkLogin(login, user.id);
    data.login = login;
  }
  if (body.password) data.password = String(body.password);
  if (body.roleId !== undefined && (Number(body.roleId) || null) !== user.roleId) {
    if (self) throw fail(403, "O'z rolingizni o'zgartira olmaysiz");
    await checkRole(body.roleId);
    data.roleId = Number(body.roleId);
  }
  if (body.active !== undefined && !!body.active !== user.active) {
    if (self) throw fail(403, "O'zingizni bloklay olmaysiz");
    data.active = !!body.active;
  }

  await user.update(data);
  res.json(view(await User.findByPk(user.id, { include })));
};

exports.remove = async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw fail(404, 'Foydalanuvchi topilmadi');
  if (user.id === req.user.id) throw fail(403, "O'zingizni o'chira olmaysiz");
  guardAdmin(req, user);

  await user.destroy();
  res.json({ ok: true });
};
