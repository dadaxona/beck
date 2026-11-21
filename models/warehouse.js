'use strict';

module.exports = (sequelize, DataTypes) => {
  const Warehouse = sequelize.define('Warehouse', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
  });

  return Warehouse;
};
