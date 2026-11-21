'use strict';

/**
 * Zakaz (buyurtma): Telegram mini app'lardan keladi.
 *  source = client   - mijozlar mini app'i (internet magazin)
 *  source = employee - xodimlar (agentlar) mini app'i
 * Zakaz SOTUV EMAS: ombor qoldig'i va kassaga ta'sir qilmaydi. Kassir uni "Sotuvga olish" bilan
 * Sotuv oynasiga tushiradi va sotuv qabul qilinganda zakaz "sold" bo'ladi (saleId bilan).
 *
 * status: new (yangi, ko'rilmagan) | seen (ko'rilgan) | sold (sotuvga aylangan) | cancelled (bekor qilingan)
 */
module.exports = (sequelize, DataTypes) => {
  const money = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });
  const text = (max = 255) => ({ type: DataTypes.STRING(max), allowNull: false, defaultValue: '' });

  const Order = sequelize.define('Order', {
    number: text(),
    date: { type: DataTypes.DATEONLY, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'client' }, // client | employee
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'new' },
    customerName: text(),
    phone: text(),
    address: text(500),
    comment: text(1000),
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'UZS' },
    priceType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'retail' }, // retail | wholesale
    total: money(),
    telegramId: { type: DataTypes.STRING, allowNull: true }, // mijozning Telegram ID si (javob xabari uchun)
    telegramName: text(),
  });

  Order.associate = (db) => {
    Order.belongsTo(db.Contractor, { as: 'contractor', foreignKey: 'contractorId', onDelete: 'SET NULL' });
    Order.belongsTo(db.User, { as: 'user', foreignKey: 'userId', onDelete: 'SET NULL' });
    Order.belongsTo(db.Sale, { as: 'sale', foreignKey: 'saleId', onDelete: 'SET NULL' });
    Order.hasMany(db.OrderItem, { as: 'items', foreignKey: 'orderId' });
  };

  return Order;
};
