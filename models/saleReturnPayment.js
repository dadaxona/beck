'use strict';

// Mijozga qaytarilgan pul: qaysi kassadan qancha chiqqan (faqat provodka qilingan qaytarishlar uchun)
module.exports = (sequelize, DataTypes) => {
  const SaleReturnPayment = sequelize.define('SaleReturnPayment', {
    amount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
  });

  SaleReturnPayment.associate = (db) => {
    SaleReturnPayment.belongsTo(db.SaleReturn, { foreignKey: 'saleReturnId', onDelete: 'CASCADE' });
    SaleReturnPayment.belongsTo(db.CashDesk, { as: 'cashDesk', foreignKey: 'cashDeskId' });
  };

  return SaleReturnPayment;
};
