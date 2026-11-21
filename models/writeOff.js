'use strict';

/**
 * Spisat (hisobdan chiqarish): tovar omborda yo'qoladi (buzilgan, yo'qolgan, muddati o'tgan...).
 * Bir yozuv = bir tovar. Keyin qaytarish mumkin (qisman ham): qaytarilgan soni omborga qaytadi.
 * Zarar summasi = (soni - qaytarilgani) * olish narxi (moliya hisobotiga xarajat bo'lib kiradi).
 */
module.exports = (sequelize, DataTypes) => {
  const num = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const WriteOff = sequelize.define('WriteOff', {
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
    rate: { type: DataTypes.FLOAT, allowNull: true }, // valyuta kursi hujjat yaratilgan paytda (1 birlik = N UZS)
    quantity: num(),  // spisat qilingan son
    costPrice: num(), // shu paytdagi olish narxi
    sum: num(),       // quantity * costPrice
    comment: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    posted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // omborga ta'sir qilmoqda
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  WriteOff.associate = (db) => {
    WriteOff.belongsTo(db.Product, { as: 'product', foreignKey: 'productId', onDelete: 'RESTRICT' });
    WriteOff.belongsTo(db.Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
    WriteOff.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
    WriteOff.hasMany(db.WriteOffReturn, { as: 'returns', foreignKey: 'writeOffId' });
  };

  return WriteOff;
};
