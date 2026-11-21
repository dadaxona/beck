'use strict';

// Ko'chirish qatori: tovar va soni
module.exports = (sequelize, DataTypes) => {
  const StockTransferItem = sequelize.define('StockTransferItem', {
    quantity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  });

  StockTransferItem.associate = (db) => {
    StockTransferItem.belongsTo(db.StockTransfer, { foreignKey: 'transferId', onDelete: 'CASCADE' });
    StockTransferItem.belongsTo(db.Product, { as: 'product', foreignKey: 'productId' });
  };

  return StockTransferItem;
};
