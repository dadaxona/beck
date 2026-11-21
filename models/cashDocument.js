'use strict';

/**
 * Kassa hujjati.
 *  income   - Kassaga kirim
 *  expense  - Kassadan chiqim
 *  transfer - Kontragentlar o'rtasida mablag' o'tkazish
 *
 * Valyuta qoidasi: hisob summasi = kassa summasi * coef1 / coef2
 * (transferda: "kassa summasi" = chiqish summasi, "hisob summasi" = oxirgi summa).
 */
module.exports = (sequelize, DataTypes) => {
  const money = (defaultValue = 0) => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue });

  const CashDocument = sequelize.define('CashDocument', {
    type: { type: DataTypes.STRING, allowNull: false },
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    posted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // o'chirishga belgilangan (1C dagi X): hisob-kitobda qatnashmaydi, ro'yxatda qoladi

    partyType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'contractor' }, // contractor | other
    terminal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },        // kassa valyutasi (transferda: chiqish valyutasi)
    accountCurrency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' }, // hisob valyutasi (transferda: oxirgi valyuta)
    rate: { type: DataTypes.FLOAT, allowNull: true },        // kassa valyutasi kursi (hujjat paytida)
    accountRate: { type: DataTypes.FLOAT, allowNull: true }, // hisob valyutasi kursi (hujjat paytida)
    cashAmount: money(),
    accountAmount: money(),
    coef1: money(1),
    coef2: money(1),

    comment: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  });

  CashDocument.associate = (db) => {
    CashDocument.belongsTo(db.CashDesk, { as: 'cashDesk', foreignKey: 'cashDeskId' });
    CashDocument.belongsTo(db.Contractor, { as: 'contractor', foreignKey: 'contractorId' });
    CashDocument.belongsTo(db.Contractor, { as: 'fromContractor', foreignKey: 'fromContractorId' });
    CashDocument.belongsTo(db.Contractor, { as: 'toContractor', foreignKey: 'toContractorId' });
    CashDocument.belongsTo(db.CashArticle, { as: 'article', foreignKey: 'articleId' });
    CashDocument.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
  };

  return CashDocument;
};
