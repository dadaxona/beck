'use strict';

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    login: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // false bo'lsa tizimga kira olmaydi
    telegramId: { type: DataTypes.STRING, allowNull: true }, // Xodimlar mini app'iga bog'langan Telegram akkaunt
  });

  // roleId (Role.associate da): null = administrator (to'liq huquq)
  User.associate = (db) => {
    User.belongsTo(db.Contractor, { as: 'contractor', foreignKey: 'contractorId', onDelete: 'SET NULL' });
  };

  return User;
};
