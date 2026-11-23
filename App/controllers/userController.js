const { UniqueConstraintError } = require('sequelize');
const { sequelize, User, Role, Contractor } = require('../../models');
const { hashPassword } = require('../utils/password');
const { sanitize } = require('../../config/permissions');

const include = [
  { model: Contractor, as: 'contractor', attributes: ['id', 'name'] },
  { model: Role, as: 'role', attributes: ['id', 'name', 'permissions'] },
];

const MAX_LOGIN = 60;
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 200; // kirishda ham shu chegara (uzunrog'ini o'rnatib, keyin kira olmay qolmasin)
const { Limiter } = require('../utils/rateLimit');
const { currentOrg } = require('../../database/tenant');
// Foydalanuvchi yaratish/login o'zgartirish: tashkilotga soatiga 60 ta (boshqa tashkilot loginlarini taxmin qilib bo'lmasin)
const userWrites = new Limiter({ windowMs: 3600_000, max: 60 });
const limitWrites = () => {
  if (!userWrites.allow(String(currentOrg()))) throw fail(429, "Juda ko'p urinish. Birozdan keyin urinib ko'ring");
};
const checkPasswordLength = (p) => {
  if (p.length < MIN_PASSWORD) throw fail(400, "Parol kamida 4 belgidan iborat bo'lsin");
  if (p.length > MAX_PASSWORD) throw fail(400, 'Parol 200 belgidan oshmasin');
};

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
  isAdmin: !!u.owner,
  /** Xodimlar mini app'iga Telegram akkaunt bog'langanmi */
  telegramLinked: !!u.telegramId,
});

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Ruxsatlar to'plami actor ruxsatlari ichidami (administrator uchun doim ha) */
function withinOwn(req, permissions) {
  if (req.user.isAdmin) return true;
  return Object.entries(sanitize(permissions)).every(([section, actions]) => {
    const own = req.user.permissions[section] || [];
    return actions.every((a) => own.includes(a));
  });
}

/**
 * Kim kimni boshqara oladi:
 *  - tashkilot egasini (administrator) faqat administrator o'zgartiradi;
 *  - administrator bo'lmagan xodim faqat ruxsatlari O'ZINIKIDAN KENG BO'LMAGAN xodimlarni boshqaradi
 *    (aks holda parolini almashtirib, kuchliroq hisobni egallab olishi mumkin edi).
 */
function guardTarget(req, target) {
  if (target.owner && !req.user.isAdmin) throw fail(403, "Administratorni faqat administrator o'zgartira oladi");
  if (!withinOwn(req, target.role ? target.role.permissions : {})) {
    throw fail(403, "Sizdan ko'proq ruxsati bor foydalanuvchini o'zgartira olmaysiz");
  }
}

async function checkContractor(contractorId, exceptUserId, transaction) {
  const contractor = await Contractor.findByPk(contractorId, { transaction });
  if (!contractor) throw fail(404, 'Kontragent topilmadi');
  const linked = await User.findOne({ where: { contractorId: contractor.id }, transaction });
  if (linked && linked.id !== exceptUserId) {
    throw fail(409, 'Bu kontragentga login allaqachon berilgan');
  }
  return contractor;
}

async function checkLogin(login, exceptUserId, transaction) {
  if (!login) throw fail(400, 'Login kiritilishi shart');
  if (login.length > MAX_LOGIN) throw fail(400, 'Login 60 belgidan oshmasin');
  // Login butun platformada noyob: barcha tashkilotlar bo'yicha tekshiriladi
  const same = await User.findOne({ where: { login }, skipTenant: true, transaction });
  if (same && same.id !== exceptUserId) throw fail(409, 'Bu login band');
}

/** Rol: shu tashkilotniki va (administrator bo'lmasa) ruxsatlari o'zinikidan keng emas. Tranzaksiyada qulflanadi. */
async function checkRole(req, roleId, transaction) {
  if (!roleId) throw fail(400, 'Rolni tanlang');
  const role = await Role.findByPk(roleId, { transaction, lock: transaction && transaction.LOCK ? transaction.LOCK.UPDATE : undefined });
  if (!role) throw fail(404, 'Rol topilmadi');
  if (!withinOwn(req, role.permissions)) throw fail(403, "O'zingizda yo'q ruxsatli rolni bera olmaysiz");
  return role;
}

/** Bir vaqtda ikki so'rov bir xil login bilan kelsa - 500 emas, 409 */
const uniqueLogin = (err) => {
  if (err instanceof UniqueConstraintError) throw fail(409, 'Bu login band');
  throw err;
};

exports.list = async (req, res) => {
  const users = await User.findAll({ include, order: [['name', 'ASC']] });
  res.json(users.map(view));
};

exports.create = async (req, res) => {
  const body = req.body || {};
  const login = String(body.login || '').trim();
  const password = String(body.password || '');

  if (!body.contractorId) throw fail(400, 'Xodimni (kontragentni) tanlang');
  checkPasswordLength(password);
  limitWrites();
  const passwordHash = await hashPassword(password);

  const id = await sequelize
    .transaction(async (t) => {
      const contractor = await checkContractor(Number(body.contractorId), null, t);
      const role = await checkRole(req, Number(body.roleId), t); // avval rol: noto'g'ri so'rov login band/bo'shligini bilib olmasin
      await checkLogin(login, null, t);
      const created = await User.create(
        {
          login,
          password: passwordHash,
          name: contractor.name,
          contractorId: contractor.id,
          roleId: role.id,
          owner: false,
          active: body.active === undefined ? true : !!body.active,
        },
        { transaction: t },
      );
      return created.id;
    })
    .catch(uniqueLogin);
  res.status(201).json(view(await User.findByPk(id, { include })));
};

exports.update = async (req, res) => {
  const body = req.body || {};
  const self = Number(req.params.id) === req.user.id;

  const revoked = await sequelize
    .transaction(async (t) => {
      const user = await User.findByPk(req.params.id, { include: [{ model: Role, as: 'role' }], transaction: t });
      if (!user) throw fail(404, 'Foydalanuvchi topilmadi');
      if (!self) guardTarget(req, user);
      const data = {};
      let revoke = false; // parol/login o'zgarsa - barcha qurilmalardagi sessiyalar bekor

      if (body.contractorId !== undefined && Number(body.contractorId) !== user.contractorId) {
        if (!body.contractorId) throw fail(400, 'Xodimni (kontragentni) tanlang');
        data.name = (await checkContractor(Number(body.contractorId), user.id, t)).name;
        data.contractorId = Number(body.contractorId);
      }
      if (body.login !== undefined) {
        const login = String(body.login).trim();
        if (login !== user.login) {
          limitWrites();
          await checkLogin(login, user.id, t);
          data.login = login;
          revoke = true;
        }
      }
      if (body.password) {
        checkPasswordLength(String(body.password));
        data.password = await hashPassword(String(body.password));
        data.telegramId = null; // yangi parol - mini app'ga qaytadan kirish kerak
        revoke = true;
      }
      if (body.roleId !== undefined && (Number(body.roleId) || null) !== user.roleId) {
        if (self) throw fail(403, "O'z rolingizni o'zgartira olmaysiz");
        if (user.owner) throw fail(400, "Tashkilot egasining roli yo'q: unda to'liq huquq bor");
        data.roleId = (await checkRole(req, Number(body.roleId), t)).id;
      }
      if (body.active !== undefined && !!body.active !== user.active) {
        if (self) throw fail(403, "O'zingizni bloklay olmaysiz");
        if (user.owner) throw fail(403, "Tashkilot egasini bloklab bo'lmaydi");
        data.active = !!body.active;
      }
      // Administrator xodimning Telegram (mini app) bog'lanishini uzishi mumkin
      if (body.unlinkTelegram === true) data.telegramId = null;
      if (revoke) data.tokenVersion = (user.tokenVersion || 0) + 1;

      await user.update(data, { transaction: t });
      return revoke;
    })
    .catch(uniqueLogin);

  const updated = await User.findByPk(req.params.id, { include });
  // O'z parolini/loginini o'zgartirgan foydalanuvchi shu oynada ishlashda davom etadi (boshqa qurilmalar chiqib ketadi)
  if (self && revoked) res.setHeader('X-New-Token', require('./authController').sign(updated));
  res.json(view(updated));
};

exports.remove = async (req, res) => {
  const user = await User.findByPk(req.params.id, { include: [{ model: Role, as: 'role' }] });
  if (!user) throw fail(404, 'Foydalanuvchi topilmadi');
  if (user.id === req.user.id) throw fail(403, "O'zingizni o'chira olmaysiz");
  if (user.owner) throw fail(403, "Tashkilot egasini o'chirib bo'lmaydi");
  guardTarget(req, user);

  await user.destroy();
  res.json({ ok: true });
};
