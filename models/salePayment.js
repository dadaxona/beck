'use strict';

/**
 * Sotuv vaqtida olingan to'lov (naqd / karta ...): qaysi kassaga qancha tushgan.
 * Kassa qoldig'iga qo'shiladi. (Savatdagi sotuv keyin Kassaga kirim orqali to'lansa, u alohida hujjat.)
 */
module.exports = (sequelize, DataTypes) => {
  const SalePayment = sequelize.define('SalePayment', {
    amount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
  });

  SalePayment.associate = (db) => {
    SalePayment.belongsTo(db.Sale, { foreignKey: 'saleId', onDelete: 'CASCADE' });
    SalePayment.belongsTo(db.CashDesk, { as: 'cashDesk', foreignKey: 'cashDeskId' });
  };

  return SalePayment;
};
