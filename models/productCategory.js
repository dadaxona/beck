'use strict';

module.exports = (sequelize, DataTypes) => {
  // Tovar kategoriyalari (kontragent kategoriyalaridan alohida)
  const ProductCategory = sequelize.define('ProductCategory', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
  });

  ProductCategory.associate = (db) => {
    db.Product.belongsTo(ProductCategory, { as: 'category', foreignKey: 'categoryId', onDelete: 'SET NULL' });
    ProductCategory.hasMany(db.Product, { foreignKey: 'categoryId' });
  };

  return ProductCategory;
};
