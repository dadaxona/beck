'use strict';

module.exports = (sequelize, DataTypes) => {
  // Tovar kategoriyalari (kontragent kategoriyalaridan alohida)
  const ProductCategory = sequelize.define('ProductCategory', {
    name: { type: DataTypes.STRING, allowNull: false },
  }, {
    // Tashkilot ichida noyob (har mijozda o'z "name" lari)
    indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
  });

  ProductCategory.associate = (db) => {
    db.Product.belongsTo(ProductCategory, { as: 'category', foreignKey: 'categoryId', onDelete: 'SET NULL' });
    ProductCategory.hasMany(db.Product, { foreignKey: 'categoryId' });
  };

  return ProductCategory;
};
