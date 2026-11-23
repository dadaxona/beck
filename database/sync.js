'use strict';

/**
 * Bazani modellarga moslaydi (migratsiyasiz, SQLite / PostgreSQL / MySQL):
 *  1) mavjud jadvallarga yetishmayotgan ustunlarni qo'shadi (sync indekslaridan OLDIN: indeks yangi ustunga tayanadi);
 *  2) ko'p tashkilotli rejimga o'tish: tashkiloti yo'q eski yozuvlar birinchi tashkilotga biriktiriladi;
 *  3) eski "butun bazada noyob" cheklovlar (ombor nomi, rol nomi, sozlama kaliti ...) olib tashlanadi -
 *     o'rniga "tashkilot ichida noyob" indekslar keladi (aks holda ikkinchi mijoz "Asosiy" omborini yarata olmaydi);
 *  4) sequelize.sync(): yangi jadvallar va yetishmayotgan indekslar.
 * Faqat qo'shadi / moslaydi: mavjud ma'lumot o'chirilmaydi.
 */
const { QueryTypes } = require('sequelize');
const { ATTR } = require('./tenant');

const tableNameOf = (model) => {
  const t = model.getTableName();
  return typeof t === 'string' ? t : t.tableName;
};

/** Qo'shilgan ustunlar ro'yxatini qaytaradi: ["Users.owner", ...] */
async function addMissingColumns(sequelize) {
  const qi = sequelize.getQueryInterface();
  const added = [];
  for (const model of Object.values(sequelize.models)) {
    const table = tableNameOf(model);
    if (!(await qi.tableExists(table))) continue;
    const existing = await qi.describeTable(table);
    for (const [name, attribute] of Object.entries(model.getAttributes())) {
      const column = attribute.field || name;
      if (column in existing) continue;
      await qi.addColumn(table, column, attribute);
      added.push(`${table}.${column}`);
      console.log(`Ustun qo'shildi: ${table}.${column}`);
    }
  }
  return added;
}

/**
 * "owner" (tashkilot egasi) ustuni endi qo'shilgan bo'lsa: eski qoidada administrator = roli yo'q foydalanuvchi edi -
 * ular ega bo'lib qoladi (faqat bir marta, ustun qo'shilganda).
 */
async function backfillOwners(sequelize, added) {
  const table = tableNameOf(sequelize.models.User);
  if (!added.includes(`${table}.owner`)) return;
  const q = sequelize.getQueryInterface().queryGenerator;
  await sequelize.query(
    `UPDATE ${q.quoteTable(table)} SET ${q.quoteIdentifier('owner')} = :yes WHERE ${q.quoteIdentifier('roleId')} IS NULL`,
    { replacements: { yes: true } },
  );
  console.log('Administratorlar tashkilot egasi qilib belgilandi');
}

/** Tashkiloti yo'q eski yozuvlar (bitta do'konli davrdan) birinchi tashkilotga biriktiriladi */
async function migrateLegacyRows(sequelize) {
  const qi = sequelize.getQueryInterface();
  const q = qi.queryGenerator;
  const { Organization } = sequelize.models;
  await Organization.sync();

  const scoped = [];
  for (const model of Object.values(sequelize.models)) {
    if (!model.rawAttributes[ATTR]) continue;
    const table = tableNameOf(model);
    if (!(await qi.tableExists(table))) continue;
    const [row] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM ${q.quoteTable(table)} WHERE ${q.quoteIdentifier(ATTR)} IS NULL`,
      { type: QueryTypes.SELECT },
    );
    if (Number(row.c) > 0) scoped.push(table);
  }
  if (!scoped.length) return;

  // Foydalanuvchisiz eski baza (dastur ochilgan-u, hech kim ro'yxatdan o'tmagan): faqat avtomatik standart yozuvlar bor.
  // Ega yo'q tashkilot yaratmaymiz - bu yozuvlar o'chiriladi (har bir tashkilotda ro'yxatdan o'tganda qayta yaratiladi).
  const usersTable = tableNameOf(sequelize.models.User);
  const defaultsOnly = ['Warehouses', 'Contractors', 'CashDesks', 'CashArticles', 'Categories', 'Settings'];
  if (!scoped.includes(usersTable) && scoped.every((t) => defaultsOnly.includes(t))) {
    const [{ n }] = await sequelize.query(`SELECT COUNT(*) AS n FROM ${q.quoteTable(usersTable)}`, { type: QueryTypes.SELECT });
    if (Number(n) === 0) {
      for (const table of scoped) {
        await sequelize.query(`DELETE FROM ${q.quoteTable(table)} WHERE ${q.quoteIdentifier(ATTR)} IS NULL`);
      }
      console.log("Eski bazada foydalanuvchi yo'q: avtomatik standart yozuvlar tozalandi");
      return;
    }
  }

  // Tashkilot nomi: eski chek sozlamalaridagi "Tashkilot nomi" (bo'lsa)
  let name = '';
  if (scoped.includes(tableNameOf(sequelize.models.Setting))) {
    const rows = await sequelize.query(
      `SELECT ${q.quoteIdentifier('value')} AS v FROM ${q.quoteTable(tableNameOf(sequelize.models.Setting))} WHERE ${q.quoteIdentifier('key')} = 'receipt'`,
      { type: QueryTypes.SELECT },
    );
    try {
      const v = rows[0] && (typeof rows[0].v === 'string' ? JSON.parse(rows[0].v) : rows[0].v);
      name = (v && v.layout && String(v.layout.shopName || '').trim()) || '';
    } catch {
      name = '';
    }
  }
  let org = await Organization.findOne({ order: [['id', 'ASC']] });
  if (!org) org = await Organization.create({ name: name || 'Mening tashkilotim' });

  for (const table of scoped) {
    await sequelize.query(
      `UPDATE ${q.quoteTable(table)} SET ${q.quoteIdentifier(ATTR)} = :org WHERE ${q.quoteIdentifier(ATTR)} IS NULL`,
      { replacements: { org: org.id } },
    );
    console.log(`Tashkilotga biriktirildi: ${table} -> #${org.id}`);
  }
}

/** Model "tashkilot ichida noyob" indeksidan eski bitta ustunli noyob ustunni topadi */
const perOrgUniqueColumns = (model) =>
  (model.options.indexes || [])
    .filter((ix) => ix.unique && Array.isArray(ix.fields) && ix.fields.length === 2 && ix.fields[0] === ATTR)
    .map((ix) => (typeof ix.fields[1] === 'string' ? ix.fields[1] : ix.fields[1].name));

/** SQLite: ustunga yozilgan UNIQUE ni o'chirib bo'lmaydi - jadval yangi ta'rif bilan qayta quriladi (ma'lumot ko'chiriladi) */
async function rebuildSqliteTable(sequelize, model) {
  const qi = sequelize.getQueryInterface();
  const q = qi.queryGenerator;
  const table = tableNameOf(model);
  const tmp = `${table}__mt`;

  // Avvalgi yarim qolgan urinishdan tiklash
  if (await qi.tableExists(tmp)) {
    if (!(await qi.tableExists(table))) {
      await sequelize.query(`ALTER TABLE ${q.quoteTable(tmp)} RENAME TO ${q.quoteTable(table)}`);
      return;
    }
    await sequelize.query(`DROP TABLE ${q.quoteTable(tmp)}`);
  }

  const old = await qi.describeTable(table);
  const columns = Object.entries(model.tableAttributes)
    .map(([name, a]) => a.field || name)
    .filter((c) => c in old)
    .map((c) => q.quoteIdentifier(c))
    .join(', ');

  await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    await sequelize.query('BEGIN');
    try {
      await qi.createTable(tmp, model.tableAttributes, {}, model);
      await sequelize.query(`INSERT INTO ${q.quoteTable(tmp)} (${columns}) SELECT ${columns} FROM ${q.quoteTable(table)}`);
      await sequelize.query(`DROP TABLE ${q.quoteTable(table)}`);
      await sequelize.query(`ALTER TABLE ${q.quoteTable(tmp)} RENAME TO ${q.quoteTable(table)}`);
      await sequelize.query('COMMIT');
    } catch (err) {
      await sequelize.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON');
  }
  console.log(`Jadval qayta qurildi (tashkilot ichida noyob): ${table}`);
}

async function dropLegacyUniques(sequelize) {
  const qi = sequelize.getQueryInterface();
  const q = qi.queryGenerator;
  const dialect = sequelize.getDialect();

  for (const model of Object.values(sequelize.models)) {
    const cols = perOrgUniqueColumns(model);
    if (!cols.length) continue;
    const table = tableNameOf(model);
    if (!(await qi.tableExists(table))) continue;

    const indexes = await qi.showIndex(table);
    const legacy = indexes.filter((ix) => {
      const fields = (ix.fields || []).map((f) => f.attribute || f.name);
      return ix.unique && !ix.primary && fields.length === 1 && cols.includes(fields[0]);
    });
    if (!legacy.length) continue;

    if (dialect === 'sqlite') {
      await rebuildSqliteTable(sequelize, model);
      continue;
    }
    for (const ix of legacy) {
      if (dialect === 'postgres') {
        // Ustundagi UNIQUE - bu constraint (uning indeksi alohida o'chirilmaydi); oddiy noyob indeks bo'lsa - DROP INDEX
        try {
          await sequelize.query(`ALTER TABLE ${q.quoteTable(table)} DROP CONSTRAINT ${q.quoteIdentifier(ix.name)}`);
        } catch {
          await sequelize.query(`DROP INDEX IF EXISTS ${q.quoteIdentifier(ix.name)}`);
        }
      } else {
        await sequelize.query(`ALTER TABLE ${q.quoteTable(table)} DROP INDEX ${q.quoteIdentifier(ix.name)}`);
      }
      console.log(`Eski noyoblik olib tashlandi: ${table}.${ix.name}`);
    }
  }
}

/**
 * Har bir tashkilotda kamida bitta ega (administrator) bo'lsin. Yo'q bo'lsa (masalan migratsiya o'rtada uzilgan):
 * roli yo'q foydalanuvchilar ega bo'ladi, ular ham bo'lmasa - eng birinchi foydalanuvchi. Har ishga tushganda tekshiriladi.
 */
async function ensureOwners(sequelize) {
  const { Organization, User } = sequelize.models;
  for (const org of await Organization.findAll({ attributes: ['id'] })) {
    const where = { organizationId: org.id };
    if (await User.count({ where: { ...where, owner: true }, skipTenant: true })) continue;
    const [n] = await User.update({ owner: true }, { where: { ...where, roleId: null }, skipTenant: true });
    if (n) continue;
    const first = await User.findOne({ where, order: [['id', 'ASC']], skipTenant: true });
    if (first) await first.update({ owner: true }, { skipTenant: true });
  }
}

async function syncSchema(sequelize) {
  const added = await addMissingColumns(sequelize);
  await backfillOwners(sequelize, added);
  await migrateLegacyRows(sequelize);
  await dropLegacyUniques(sequelize);
  await sequelize.sync();
  await ensureOwners(sequelize);
}

module.exports = { syncSchema };
