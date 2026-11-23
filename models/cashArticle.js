'use strict';

// Kassa moddasi / maqsadi (1C dagi "Назначение" / "Статья")
module.exports = (sequelize, DataTypes) => {
  const CashArticle = sequelize.define('CashArticle', {
    name: { type: DataTypes.STRING, allowNull: false },
  }, {
    // Tashkilot ichida noyob (har mijozda o'z "name" lari)
    indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
  });

  return CashArticle;
};
