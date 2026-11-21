'use strict';

module.exports = (sequelize, DataTypes) => {
  const num = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const SaleReturnItem = sequelize.define('SaleReturnItem', {
    quantity: num(), // qaytgan soni
    price: num(),    // sotuvdagi narx
    sum: num(),
  });

  SaleReturnItem.associate = (db) => {
    SaleReturnItem.belongsTo(db.SaleReturn, { foreignKey: 'saleReturnId', onDelete: 'CASCADE' });
    SaleReturnItem.belongsTo(db.SaleItem, { as: 'saleItem', foreignKey: 'saleItemId', onDelete: 'RESTRICT' });
    SaleReturnItem.belongsTo(db.Product, { as: 'product', foreignKey: 'productId', onDelete: 'RESTRICT' });
  };

  return SaleReturnItem;
};
