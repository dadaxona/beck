'use strict';

/**
 * Tashkilot (platformadagi mijoz: do'kon/korxona). Ro'yxatdan o'tgan har bir mijoz o'z tashkilotini oladi;
 * uning barcha ma'lumotlari (tovarlar, hujjatlar, xodimlar, rollar, sozlamalar) shu tashkilotga bog'langan.
 * Bu jadvalning o'zida organizationId yo'q (models/index.js qo'shmaydi).
 */
module.exports = (sequelize, DataTypes) => {
  const Organization = sequelize.define('Organization', {
    name: { type: DataTypes.STRING, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // false - tashkilot bloklangan
  });
  return Organization;
};
