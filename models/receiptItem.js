'use strict';

module.exports = (sequelize, DataTypes) => {
  const num = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const ReceiptItem = sequelize.define('ReceiptItem', {
    quantity: num(),          // Soni
    purchasePrice: num(),     // Olish narxi
    prevPurchasePrice: num(), // Oldingi olish narxi
    wholesalePrice: num(),    // Diller narxi
    retailPrice: num(),       // Sotish narxi
    sum: num(),               // Summa = soni * olish narxi
  });

  ReceiptItem.associate = (db) => {
    ReceiptItem.belongsTo(db.Receipt, { foreignKey: 'receiptId', onDelete: 'CASCADE' });
    ReceiptItem.belongsTo(db.Product, { as: 'product', foreignKey: 'productId', onDelete: 'RESTRICT' });
  };

  return ReceiptItem;
};
