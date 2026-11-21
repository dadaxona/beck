'use strict';

// Sotuv (sotish/diller narxida) hujjati. Qabul qilinganda ombor qoldig'idan ayriladi.
module.exports = (sequelize, DataTypes) => {
  const money = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const Sale = sequelize.define('Sale', {
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
    priceType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'retail' }, // retail | wholesale
    markupType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'sum' },   // sum | percent
    markupValue: money(), // Ustama qiymati (summa yoki foiz)
    markup: money(),      // Ustama summasi
    subtotal: money(),    // Tovarlar summasi
    total: money(),       // Jami (ustama bilan)
    costTotal: money(),   // Olish narxi bo'yicha tannarx
    // onCredit = SAVAT: sotuv vaqtida to'liq to'lanmagan (qarzga) sotuv. false = sotuv vaqtida to'langan.
    onCredit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    paidAmount: money(), // Sotuv vaqtida to'langan summa (savat uchun). Keyingi to'lovlar Kassaga kirim orqali.
    dueDate: { type: DataTypes.DATEONLY, allowNull: true }, // Qarzni to'lash muddati (savat): muddati kelganlar qo'ng'iroqda ko'rinadi
    // O'chirishga belgilangan (1C dagi X): tovar omborga qaytgan, to'lovi kassada hisoblanmaydi, hisobotlarga kirmaydi
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  Sale.associate = (db) => {
    Sale.belongsTo(db.Contractor, { as: 'client', foreignKey: 'clientId' });
    Sale.belongsTo(db.Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
    Sale.belongsTo(db.User, { as: 'cashier', foreignKey: 'cashierId' });
    Sale.hasMany(db.SaleItem, { as: 'items', foreignKey: 'saleId' });
    Sale.hasMany(db.SalePayment, { as: 'payments', foreignKey: 'saleId' });
  };

  return Sale;
};
