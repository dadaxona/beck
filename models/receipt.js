'use strict';

// Kirim hujjati. type: receipt (tovar kirimi) | return (yetkazib beruvchiga qaytarish) | service (xizmat kirimi)
module.exports = (sequelize, DataTypes) => {
  const money = (defaultValue = 0) => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue });

  const Receipt = sequelize.define('Receipt', {
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'receipt' },
    number: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
    rate: { type: DataTypes.FLOAT, allowNull: true }, // valyuta kursi hujjat yaratilgan paytda (1 birlik = N UZS)
    note: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    total: money(),
    posted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // provodka qilingan
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // o'chirishga belgilangan (1C dagi X): hisob-kitobda qatnashmaydi, ro'yxatda qoladi

    paymentType: { type: DataTypes.STRING, allowNull: false, defaultValue: '' }, // To'lov turi
    paidAmount: money(), // To'langan summa (kassa uchun)
    checkExpiry: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // Yaroqlilik muddati nazorati

    // Qo'shimcha xarajatlar
    transportCost: money(), // Transportirovka
    loadingCost: money(),   // Yuklash / tushirish
    storageCost: money(),   // Saqlash
    extraTotal: money(),    // Jami qo'shimcha xarajat
    extraAuto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // Avto: jami = yig'indi
    coef1: money(1),
    coef2: money(1),
  });

  Receipt.associate = (db) => {
    Receipt.belongsTo(db.Contractor, { as: 'supplier', foreignKey: 'supplierId' }); // Yetkazib beruvchi
    Receipt.belongsTo(db.Contractor, { as: 'driver', foreignKey: 'driverId' });     // Shofer
    Receipt.belongsTo(db.Contractor, { as: 'loader', foreignKey: 'loaderId' });     // Yuk tashuvchi
    Receipt.belongsTo(db.Warehouse, { as: 'warehouse', foreignKey: 'warehouseId' });
    // "To'langan summa" qaysi kassadan to'langani va avtomatik yaratilgan kassa hujjati
    Receipt.belongsTo(db.CashDesk, { as: 'cashDesk', foreignKey: 'cashDeskId' });
    Receipt.belongsTo(db.CashDocument, { as: 'cashDocument', foreignKey: 'cashDocumentId', onDelete: 'SET NULL', constraints: false });
    Receipt.belongsTo(db.User, { as: 'user', foreignKey: 'userId' });
    Receipt.hasMany(db.ReceiptItem, { as: 'items', foreignKey: 'receiptId' });
  };

  return Receipt;
};
