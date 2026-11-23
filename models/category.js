'use strict';

module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define('Category', {
    name: { type: DataTypes.STRING, allowNull: false },
  }, {
    // Tashkilot ichida noyob (har mijozda o'z "name" lari)
    indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
  });

  return Category;
};
