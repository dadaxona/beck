'use strict';

// Dastur sozlamalari (kalit -> JSON qiymat). Masalan "receipt": chek va printer sozlamalari
module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define('Setting', {
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    value: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  });
  return Setting;
};
