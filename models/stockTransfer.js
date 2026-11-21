'use strict';

/**
 * Ombordan omborga ko'chirish (1C dagi "Перемещение товаров").
 * Yozilganda tovar "qayerdan" omborining qoldig'idan ayriladi va "qayerga" omboriga qo'shiladi.
 * O'chirishga belgilansa (X) harakat bekor qilinadi, tiklansa qayta bajariladi.
 */
module.exports = (sequelize, DataTypes) => {
  const StockTransfer = sequelize.define('StockTransfer', {
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    comment: { type: DataTypes.STRING(1000), allowNull: false, defaultValue: '' },
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  StockTransfer.associate = (db) => {
    StockTransfer.belongsTo(db.Warehouse, { as: 'from', foreignKey: 'fromWarehouseId' });
    StockTransfer.belongsTo(db.Warehouse, { as: 'to', foreignKey: 'toWarehouseId' });
    StockTransfer.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
    StockTransfer.hasMany(db.StockTransferItem, { as: 'items', foreignKey: 'transferId' });
  };

  return StockTransfer;
};
