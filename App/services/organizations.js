'use strict';

/**
 * Tashkilotlar (platformadagi mijozlar).
 *  - register(): yangi mijoz o'zi ro'yxatdan o'tadi -> tashkilot + uning administratori + standart ma'lumotlar.
 *  - ensureDefaults(): har bir tashkilotda bo'lishi shart bo'lgan yozuvlar (ishga tushganda ham tekshiriladi).
 */
const { sequelize, Organization, User, Warehouse, Contractor, CashDesk, CashArticle, Category, Setting } = require('../../models');
const { UniqueConstraintError } = require('sequelize');
const { runWithOrg } = require('../../database/tenant');
const { hashPassword } = require('../utils/password');
const numbering = require('./numbering');

const fail = (status, message) => Object.assign(new Error(message), { status });

const BLACKLIST_CATEGORY = "Qora ro'yxat";

/**
 * Tashkilotning standart yozuvlari (bor bo'lsa tegilmaydi). Tashkilot kontekstida chaqiriladi.
 * SQLite parallel tranzaksiyani qabul qilmaydi - ketma-ket.
 */
async function ensureDefaults(transaction, { onlyMissing = false } = {}) {
  const opts = transaction ? { transaction } : {};
  // onlyMissing (ishga tushganda): ombor/kassa/modda faqat UMUMAN yo'q bo'lsa yaratiladi -
  // foydalanuvchi "Asosiy" ni qayta nomlasa yoki kassani o'chirsa, har safar qayta paydo bo'lmasin
  const none = async (model) => !onlyMissing || (await model.count(opts)) === 0;
  if (await none(Warehouse)) await Warehouse.findOrCreate({ where: { name: 'Asosiy' }, ...opts }); // standart ombor
  // Sotuvdagi standart mijoz va "Qora ro'yxat" nomi bo'yicha qidiriladi (dastur mantiqi) - doim bo'lishi shart
  await Contractor.findOrCreate({ where: { name: 'Chakana mijoz' }, defaults: { relation: 'B2C' }, ...opts });
  if (await none(CashDesk)) {
    await CashDesk.findOrCreate({ where: { name: 'Naqd' }, ...opts });
    await CashDesk.findOrCreate({ where: { name: 'Plastik' }, ...opts });
    await CashDesk.findOrCreate({ where: { name: 'Bank' }, ...opts });
  }
  if (await none(CashArticle)) await CashArticle.findOrCreate({ where: { name: "To'lov" }, ...opts });
  const [cat] = await Category.findOrCreate({ where: { name: BLACKLIST_CATEGORY }, ...opts }); // "Qora ro'yxat"
  // Hujjat raqami hisoblagichlari oldindan (birinchi hujjatlar parallel yaratilganda qulf to'qnashuvi bo'lmasin)
  await numbering.ensureCounters(transaction);
  await Contractor.update({ categoryId: cat.id }, { where: { blacklisted: true }, ...opts });
}

/** Ishga tushganda: barcha tashkilotlarning standart yozuvlari */
async function ensureAllDefaults() {
  const orgs = await Organization.findAll({ attributes: ['id'] });
  for (const org of orgs) await runWithOrg(org.id, () => ensureDefaults(null, { onlyMissing: true }));
}

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * Ro'yxatdan o'tish (doim ochiq): yangi tashkilot va uning administratori (rolsiz = to'liq huquq).
 * Login butun platformada noyob (kirishda tashkilot so'ralmaydi).
 */
async function register(input) {
  const orgName = clean(input.organization, 120);
  const name = clean(input.name, 120);
  const login = String(input.login == null ? '' : input.login).trim();
  const password = String(input.password || '');
  if (!orgName) throw fail(400, "Tashkilot (do'kon) nomini kiriting");
  if (!name || !login || !password) throw fail(400, 'Ism, login va parol kiritilishi shart');
  if (password.length < 4) throw fail(400, "Parol kamida 4 belgidan iborat bo'lsin");
  if (password.length > 200) throw fail(400, 'Parol 200 belgidan oshmasin');
  if (login.length > 60) throw fail(400, 'Login 60 belgidan oshmasin');
  if (await User.findOne({ where: { login }, skipTenant: true })) throw fail(409, 'Bu login band');
  const passwordHash = await hashPassword(password);

  return sequelize.transaction(async (t) => {
    const org = await Organization.create({ name: orgName }, { transaction: t });
    return runWithOrg(org.id, async () => {
      const user = await User.create({ name, login, password: passwordHash, owner: true }, { transaction: t });
      await ensureDefaults(t);
      // Hujjatlarda (chek, akt sverka) chiqadigan tashkilot nomi
      await Setting.create(
        { key: 'receipt', value: { layout: { shopName: orgName } } },
        { transaction: t },
      );
      return { org, user };
    });
  }).catch((err) => {
    // Bir vaqtda ikki ro'yxatdan o'tish bir xil login bilan: ikkinchisi 500 emas, 409
    if (err instanceof UniqueConstraintError) throw fail(409, 'Bu login band');
    throw err;
  });
}

module.exports = { register, ensureDefaults, ensureAllDefaults, BLACKLIST_CATEGORY };
