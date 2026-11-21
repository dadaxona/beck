'use strict';

module.exports = (sequelize, DataTypes) => {
  const num = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const SaleItem = sequelize.define('SaleItem', {
    quantity: num(),
    price: num(),     // Sotuv narxi
    costPrice: num(), // Sotilgan paytdagi olish narxi (foyda hisobi uchun)
    sum: num(),       // quantity * price
  });

  SaleItem.associate = (db) => {
    SaleItem.belongsTo(db.Sale, { foreignKey: 'saleId', onDelete: 'CASCADE' });
    SaleItem.belongsTo(db.Product, { as: 'product', foreignKey: 'productId', onDelete: 'RESTRICT' });
  };

  return SaleItem;
};
