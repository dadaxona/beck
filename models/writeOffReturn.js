'use strict';

// Spisat qilingan tovarni omborga qaytarish (qisman yoki to'liq)
module.exports = (sequelize, DataTypes) => {
  const WriteOffReturn = sequelize.define('WriteOffReturn', {
    date: { type: DataTypes.DATEONLY, allowNull: false },
    quantity: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    comment: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  });

  WriteOffReturn.associate = (db) => {
    WriteOffReturn.belongsTo(db.WriteOff, { foreignKey: 'writeOffId', onDelete: 'CASCADE' });
    WriteOffReturn.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
  };

  return WriteOffReturn;
};
