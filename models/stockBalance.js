'use strict';

// Ombor qoldiqlari registri: tovar + ombor bo'yicha joriy qoldiq
module.exports = (sequelize, DataTypes) => {
  const StockBalance = sequelize.define(
    'StockBalance',
    {
      productId: { type: DataTypes.INTEGER, allowNull: false },
      warehouseId: { type: DataTypes.INTEGER, allowNull: false },
      quantity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    },
    { indexes: [{ unique: true, fields: ['productId', 'warehouseId'] }] },
  );

  StockBalance.associate = (db) => {
    StockBalance.belongsTo(db.Product, { foreignKey: 'productId' });
    StockBalance.belongsTo(db.Warehouse, { foreignKey: 'warehouseId' });
  };

  return StockBalance;
};
