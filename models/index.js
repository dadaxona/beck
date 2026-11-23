'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = { ...require(__dirname + '/../config/config.json')[env] };
// SQLite fayli boshqa joyda bo'lsa (masalan serverda yoki zaxira nusxada sinash uchun): SQLITE_STORAGE=/yo'l/baza.sqlite
if (process.env.SQLITE_STORAGE) Object.assign(config, { dialect: 'sqlite', storage: process.env.SQLITE_STORAGE });
const db = {};

// SQLite fayli doim backend papkasi ichida (database/...) bo'ladi.
// Nisbiy yo'l joriy papkaga emas, backend papkasiga nisbatan hisoblanadi: o'rnatilgan .exe
// yorliqdan ochilganda joriy papka boshqa bo'lib, baza o'sha yerda bo'sh holda yaratilib qolardi.
if (config.dialect === 'sqlite' && config.storage && config.storage !== ':memory:') {
  if (!path.isAbsolute(config.storage)) config.storage = path.join(__dirname, '..', config.storage);
  fs.mkdirSync(path.dirname(config.storage), { recursive: true });
}

/*
 * Tranzaksiya konteksti (CLS): sequelize.transaction(async (t) => ...) ichidagi HAR BIR so'rov avtomatik shu
 * tranzaksiyada bajariladi - hatto { transaction: t } berilmagan xizmatlarda ham (ledger, kurslar ...).
 * Aks holda SQLite da tranzaksiya yozish qulfini ushlab turganda tashqi ulanishdagi so'rov 15 s kutib qolardi.
 * cls-hooked o'rniga Node.js AsyncLocalStorage (Sequelize faqat get/set/run ni ishlatadi).
 */
{
  const { AsyncLocalStorage } = require('async_hooks');
  const store = new AsyncLocalStorage();
  Sequelize.useCLS({
    run(fn) {
      const ctx = Object.create(store.getStore() || null);
      return store.run(ctx, () => fn(ctx));
    },
    get(key) {
      const ctx = store.getStore();
      return ctx ? ctx[key] : undefined;
    },
    set(key, value) {
      const ctx = store.getStore();
      if (ctx) ctx[key] = value;
      return value;
    },
    bind(fn) {
      const ctx = store.getStore();
      return ctx ? (...args) => store.run(ctx, () => fn(...args)) : fn;
    },
  });
}

let sequelize;
if (process.env.DATABASE_URL) {
  // Serverda: DATABASE_URL=postgres://user:pass@host:5432/db yoki mysql://... (config.json o'rniga)
  sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false });
} else if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

/*
 * SQLite: bir vaqtda bir nechta yozuvchi (bir nechta kassir / tashkilot) bo'lsa "database is locked" xatosi bo'lmasin:
 *  - tranzaksiyalar IMMEDIATE: yozish qulfi BEGIN da olinadi, boshqalar navbat kutadi (DEFERRED da o'zaro tiqilib xato berardi);
 *  - busy_timeout 15 s: qulf bo'shashini kutadi;
 *  - WAL jurnal: o'qish yozishni to'smaydi.
 */
if (sequelize.getDialect() === 'sqlite') {
  sequelize.options.transactionType = Sequelize.Transaction.TYPES.IMMEDIATE;
  const cm = sequelize.connectionManager;
  const getConnection = cm.getConnection.bind(cm);
  const configured = new WeakSet();
  cm.getConnection = async (options) => {
    const connection = await getConnection(options);
    if (!configured.has(connection)) {
      configured.add(connection);
      connection.configure('busyTimeout', 15000);
      if (config.storage !== ':memory:') {
        // Xato bo'lsa jarayon yiqilmasin (masalan fayl boshqa dasturda ochiq) - shunchaki oddiy jurnal bilan ishlaydi
        connection.run('PRAGMA journal_mode=WAL', (err) => err && console.error('SQLite WAL yoqilmadi:', err.message));
      }
    }
    return connection;
  };
}

/*
 * Ko'p tashkilotli rejim: Organization dan boshqa HAR BIR modelga `organizationId` ustuni va indeks qo'shiladi
 * (model fayllarida yozish shart emas - hech biri unutilmaydi). Filtrlash: database/tenant.js hook'lari.
 * Ustun bazada NULL bo'lishi mumkin (eski bazaga qo'shish oson bo'lsin), lekin hook'lar har doim to'ldiradi.
 */
const tenant = require('../database/tenant');
const originalDefine = sequelize.define.bind(sequelize);
sequelize.define = (modelName, attributes, options = {}) => {
  if (modelName === 'Organization') return originalDefine(modelName, attributes, options);
  return originalDefine(
    modelName,
    { ...attributes, [tenant.ATTR]: { type: Sequelize.DataTypes.INTEGER, allowNull: true } },
    { ...options, indexes: [...(options.indexes || []), { fields: [tenant.ATTR] }] },
  );
};

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Foydalanuvchi tashkilotga tegishli (DB darajasida FK cheklovisiz: eski bazalarga ustun qo'shish oson bo'lsin)
db.User.belongsTo(db.Organization, { as: 'organization', foreignKey: tenant.ATTR, constraints: false });

tenant.install(sequelize);

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
