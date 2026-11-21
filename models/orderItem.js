'use strict';

// Zakaz qatori: tovar, soni, narxi (zakaz berilgan paytdagi narx)
module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define('OrderItem', {
    quantity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    price: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    sum: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  });

  OrderItem.associate = (db) => {
    OrderItem.belongsTo(db.Order, { foreignKey: 'orderId', onDelete: 'CASCADE' });
    OrderItem.belongsTo(db.Product, { as: 'product', foreignKey: 'productId' });
  };

  return OrderItem;
};
