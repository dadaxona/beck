'use strict';

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    login: { type: DataTypes.STRING, allowNull: false, unique: true }, // butun platformada noyob
    password: { type: DataTypes.STRING, allowNull: false }, // shifrlangan (App/utils/password.js)
    name: { type: DataTypes.STRING, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // false bo'lsa tizimga kira olmaydi
    telegramId: { type: DataTypes.STRING, allowNull: true }, // Xodimlar mini app'iga bog'langan Telegram akkaunt
    /**
     * Tashkilot egasi (administrator, to'liq huquq). Ro'yxatdan o'tgan odam - ega.
     * Ilgari "roli yo'q = administrator" edi: rol o'chirilganda (roleId -> NULL) xodim admin bo'lib qolishi mumkin edi.
     * Endi roli yo'q oddiy xodimda hech qanday ruxsat yo'q.
     */
    owner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    /** Token versiyasi: parol/login o'zgarsa oshadi - eski tokenlar (barcha qurilmalarda) bekor bo'ladi */
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  });

  // roleId (Role.associate da): xodimning roli (ruxsatlari)
  User.associate = (db) => {
    User.belongsTo(db.Contractor, { as: 'contractor', foreignKey: 'contractorId', onDelete: 'SET NULL' });
  };

  return User;
};
