'use strict';

/**
 * Ko'p tashkilotli (multi-tenant) rejim: har bir mijoz (tashkilot) faqat o'z ma'lumotini ko'radi.
 *
 * Qanday ishlaydi:
 *  - Har bir jadvalda `organizationId` ustuni bor (models/index.js avtomatik qo'shadi; Organization dan tashqari).
 *  - So'rov konteksti (qaysi tashkilot) AsyncLocalStorage da saqlanadi: auth middleware login qilgan
 *    foydalanuvchining tashkilotini qo'yadi, mini app'lar esa ?o=<id> parametridan.
 *  - Global Sequelize hook'lari HAR BIR so'rovga avtomatik `organizationId = <joriy tashkilot>` sharti qo'shadi
 *    (find, count, update, destroy) va yangi yozuvga tashkilotni o'zi yozadi (create, bulkCreate).
 *  - Kontekst bo'lmasa so'rov XATO beradi (jim holda boshqa tashkilot ma'lumoti chiqib ketmasin).
 *    Ataylab tashkilotlararo so'rov (masalan login bo'yicha qidirish) uchun: { skipTenant: true }.
 *  - Bog'lanish himoyasi: yozuvdagi har bir tashqi kalit (clientId, warehouseId, productId ...) shu tashkilotga
 *    tegishli yozuvga ishora qilishi tekshiriladi - boshqa tashkilotning ID sini yuborib bo'lmaydi.
 *    Shu sababli include (JOIN) lar ham doim o'z tashkiloti ichida qoladi.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { Op } = require('sequelize');

const ATTR = 'organizationId';
const als = new AsyncLocalStorage();

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Joriy tashkilot ID si (kontekst bo'lmasa null) */
const currentOrg = () => {
  const store = als.getStore();
  return store && store.orgId ? store.orgId : null;
};

/** fn ni berilgan tashkilot kontekstida bajaradi (fn ichidagi barcha so'rovlar shu tashkilot bilan cheklanadi) */
function runWithOrg(orgId, fn) {
  const id = Number(orgId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Noto'g'ri tashkilot ID: ${orgId}`);
  return als.run({ orgId: id }, fn);
}

const isScoped = (model) => !!(model && model.rawAttributes && model.rawAttributes[ATTR]);

/** Hook uchun tashkilot ID: skipTenant bo'lsa null (filtr yo'q), kontekst bo'lmasa xato */
function orgFor(model, options) {
  if (options && options.skipTenant) return null;
  const org = currentOrg();
  if (!org) {
    throw fail(500, `Tashkilot konteksti yo'q (${model.name}). So'rov tashkilot kontekstida bajarilishi kerak`);
  }
  return org;
}

const addWhere = (options, org) => {
  options.where = options.where ? { [Op.and]: [options.where, { [ATTR]: org }] } : { [ATTR]: org };
};

/* ---------------- Tashqi kalitlar (bog'lanish) xaritasi ---------------- */

let fkCache = null;

/**
 * Har bir model uchun: { tashqiKalitUstuni: maqsadModel } (faqat tashkilotli maqsad modellar).
 * BelongsTo (o'zida kalit) va boshqa modellarning HasMany/HasOne (kalit shu modelda) bog'lanishlaridan yig'iladi.
 */
function fkMap(sequelize) {
  if (fkCache) return fkCache;
  const map = new Map();
  const add = (model, attr, target) => {
    if (!isScoped(target) || attr === ATTR) return;
    if (!map.has(model)) map.set(model, {});
    map.get(model)[attr] = target;
  };
  for (const model of Object.values(sequelize.models)) {
    for (const assoc of Object.values(model.associations || {})) {
      if (assoc.associationType === 'BelongsTo') add(model, assoc.foreignKey, assoc.target);
      else if (assoc.associationType === 'HasMany' || assoc.associationType === 'HasOne') add(assoc.target, assoc.foreignKey, assoc.source);
    }
  }
  fkCache = map;
  return map;
}

/**
 * values (bir yoki bir nechta yozuv qiymatlari) dagi tashqi kalitlar shu tashkilotga tegishliligini tekshiradi.
 * Maqsad modelga count() so'rovi tenant hook bilan ketadi, ya'ni faqat o'z tashkilotidagilar sanaladi.
 */
async function assertOwnRefs(model, valuesList, options) {
  const refs = fkMap(model.sequelize).get(model);
  if (!refs) return;
  for (const [attr, target] of Object.entries(refs)) {
    const ids = [...new Set(valuesList.map((v) => v[attr]).filter((v) => v !== null && v !== undefined && v !== ''))];
    if (!ids.length) continue;
    const found = await target.count({ where: { [target.primaryKeyAttribute]: ids }, transaction: options && options.transaction });
    if (found !== ids.length) {
      throw fail(400, `Bog'langan ma'lumot topilmadi (${model.name}.${attr})`);
    }
  }
}

/* ---------------- Hook'lar ---------------- */

function stamp(model, instance, options) {
  const org = orgFor(model, options);
  if (org === null) {
    // skipTenant bilan yaratish: tashkilot qo'lda berilishi shart
    if (!instance.get(ATTR)) throw fail(500, `${model.name}: organizationId berilmagan`);
    return;
  }
  const given = instance.get(ATTR);
  if (given === null || given === undefined) instance.set(ATTR, org);
  else if (Number(given) !== org) throw fail(403, "Boshqa tashkilot ma'lumotiga yozib bo'lmaydi");
}

function install(sequelize) {
  sequelize.addHook('beforeFind', function beforeFind(options) {
    if (!isScoped(this)) return;
    const org = orgFor(this, options);
    if (org !== null) addWhere(options, org);
  });

  sequelize.addHook('beforeCount', function beforeCount(options) {
    if (!isScoped(this)) return;
    const org = orgFor(this, options);
    if (org !== null) addWhere(options, org);
  });

  sequelize.addHook('beforeBulkUpdate', async function beforeBulkUpdate(options) {
    if (!isScoped(this)) return;
    const org = orgFor(this, options);
    if (options.attributes && ATTR in options.attributes) {
      if (org === null || Number(options.attributes[ATTR]) !== org) throw fail(403, "Tashkilotni o'zgartirib bo'lmaydi");
      delete options.attributes[ATTR];
    }
    if (org !== null) {
      addWhere(options, org);
      if (options.attributes) await assertOwnRefs(this, [options.attributes], options);
    }
  });

  sequelize.addHook('beforeBulkDestroy', function beforeBulkDestroy(options) {
    if (!isScoped(this)) return;
    const org = orgFor(this, options);
    if (org !== null) addWhere(options, org);
  });

  // Yangi yozuv: tashkilot avtomatik (validatsiyadan oldin ham - allowNull tekshiruvi uchun)
  sequelize.addHook('beforeValidate', function beforeValidate(instance, options) {
    if (!isScoped(this) || !instance.isNewRecord) return;
    // skipTenant: statik Model.update(..., { skipTenant }) ham validatsiya uchun vaqtinchalik "yangi" obyekt quradi -
    // u yozilmaydi. Haqiqiy yaratishda tashkilot beforeCreate / beforeBulkCreate da baribir tekshiriladi.
    if (options && options.skipTenant) return;
    stamp(this, instance, options);
  });

  sequelize.addHook('beforeCreate', async function beforeCreate(instance, options) {
    if (!isScoped(this)) return;
    stamp(this, instance, options);
    if (!(options && options.skipTenant)) await assertOwnRefs(this, [instance.get({ plain: true })], options);
  });

  sequelize.addHook('beforeUpdate', async function beforeUpdate(instance, options) {
    if (!isScoped(this)) return;
    if (instance.changed(ATTR)) throw fail(403, "Tashkilotni o'zgartirib bo'lmaydi");
    if (options && options.skipTenant) return;
    orgFor(this, options);
    const changed = instance.changed() || [];
    const values = {};
    for (const key of changed) values[key] = instance.get(key);
    await assertOwnRefs(this, [values], options);
  });

  sequelize.addHook('beforeBulkCreate', async function beforeBulkCreate(instances, options) {
    if (!isScoped(this)) return;
    for (const instance of instances) stamp(this, instance, options);
    if (!(options && options.skipTenant)) await assertOwnRefs(this, instances.map((i) => i.get({ plain: true })), options);
  });

  /*
   * Agregat so'rovlar (sum, max, min, aggregate) Sequelize da hook'larsiz ishlaydi - ularni ham tashkilot bilan
   * cheklaymiz (kelajakda kimdir Product.sum(...) yozsa, boshqa tashkilot ma'lumoti qo'shilib ketmasin).
   * count() ham aggregate orqali o'tadi: shart ikki marta qo'shiladi (AND), natija o'zgarmaydi.
   */
  for (const model of Object.values(sequelize.models)) {
    if (!isScoped(model)) continue;
    const original = model.aggregate;
    model.aggregate = function scopedAggregate(field, fn, options = {}) {
      const opts = { ...options };
      const org = orgFor(this, opts);
      if (org !== null) addWhere(opts, org);
      return original.call(this, field, fn, opts);
    };
  }

  sequelize.addHook('beforeUpsert', function beforeUpsert() {
    if (!isScoped(this)) return;
    throw fail(500, `${this.name}: upsert tashkilot rejimida qo'llanmaydi`);
  });
}

module.exports = { ATTR, install, runWithOrg, currentOrg, isScoped, fkMap };
