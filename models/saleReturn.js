'use strict';

/**
 * Mijozdan qaytarish (Возврат от покупателя). Provodka qilinganda:
 *  - qaytgan tovarlar omborga qaytadi;
 *  - savat (qarzga) sotuv bo'lsa mijozning qarzi kamayadi;
 *  - "Pul qaytarish" belgilangan bo'lsa kassadan mijozga pul beriladi.
 */
module.exports = (sequelize, DataTypes) => {
  const money = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const SaleReturn = sequelize.define('SaleReturn', {
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
    rate: { type: DataTypes.FLOAT, allowNull: true }, // valyuta kursi hujjat yaratilgan paytda (1 birlik = N UZS)
    total: money(),  // qaytarilgan tovarlar summasi
    refund: money(), // mijozga kassadan qaytarilgan pul
    onCredit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // asl sotuv savatda (qarzga) edi
    comment: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    posted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // o'chirishga belgilangan (1C dagi X): hisob-kitobda qatnashmaydi, ro'yxatda qoladi
  });

  SaleReturn.associate = (db) => {
    SaleReturn.belongsTo(db.Sale, { as: 'sale', foreignKey: 'saleId' });
    SaleReturn.belongsTo(db.Contractor, { as: 'client', foreignKey: 'clientId' });
    SaleReturn.belongsTo(db.Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
    SaleReturn.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
    SaleReturn.hasMany(db.SaleReturnItem, { as: 'items', foreignKey: 'saleReturnId' });
    SaleReturn.hasMany(db.SaleReturnPayment, { as: 'payments', foreignKey: 'saleReturnId' });
  };

  return SaleReturn;
};
