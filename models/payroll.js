'use strict';

/**
 * Oylik hisoblash hujjati. Provodka qilinganda har bir xodimga (kontragent) summa hisoblanadi:
 * do'kon xodimga qarzdor bo'ladi. Oylik kassadan berilganda (Kassadan chiqim) qarz kamayadi.
 * Ko'p berilsa xodim do'konga qarzdor bo'lib qoladi.
 */
module.exports = (sequelize, DataTypes) => {
  const Payroll = sequelize.define('Payroll', {
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    period: { type: DataTypes.STRING, allowNull: false, defaultValue: '' }, // YYYY-MM
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
    rate: { type: DataTypes.FLOAT, allowNull: true }, // valyuta kursi hujjat yaratilgan paytda (1 birlik = N UZS)
    comment: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    total: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    posted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // o'chirishga belgilangan (1C dagi X): hisob-kitobda qatnashmaydi, ro'yxatda qoladi
  });

  Payroll.associate = (db) => {
    Payroll.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
    Payroll.hasMany(db.PayrollItem, { as: 'items', foreignKey: 'payrollId' });
  };

  return Payroll;
};
