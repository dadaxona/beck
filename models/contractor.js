'use strict';

module.exports = (sequelize, DataTypes) => {
  const str = (extra = {}) => ({ type: DataTypes.STRING, allowNull: false, defaultValue: '', ...extra });
  const bool = () => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const Contractor = sequelize.define('Contractor', {
    name: { type: DataTypes.STRING, allowNull: false },       // Наименование
    legalName: str(),                                         // Юр. наименование
    legalAddress: str(),                                      // Юридический адрес
    postalAddress: str(),                                     // Почтовый адрес
    phones: str(),                                            // Телефоны
    inn: str(),                                               // ИНН
    oked: str(),                                              // ОКЭД
    vatCode: str(),                                           // Код НДС
    representative: str(),                                    // В лице
    journalNumber: str(),                                     // Номер журнала
    creditLimit: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 }, // Продажа в долг (лимит)
    currency: str({ defaultValue: 'UZS' }),                   // Валюта учета
    segment: str(),                                           // Сегмент
    paymentTerm: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // Срок оплаты
    region: str(),                                            // Регион
    guarantor: str(),                                         // Поручитель
    barcode: str(),                                           // Штрихкод
    relation: str(),                                          // Взаимоотношения (B2C, B2B, ...)
    isOwn: bool(),                                            // Собственный
    byServices: bool(),                                       // По услугам
    byGoods: bool(),                                          // По товарам
    blacklisted: bool(),                                      // Черный список
    serviceDiscount: bool(),                                  // Скидка по услугам
    founder: bool(),                                          // Учредитель
    trackByDocuments: bool(),                                 // Вести учет по документам
    bankAccounts: { type: DataTypes.JSON, allowNull: false, defaultValue: [] }, // Расчетные счета
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // o'chirishga belgilangan (1C dagi X): hisob-kitobda qatnashmaydi, ro'yxatda qoladi
  });

  Contractor.associate = (db) => {
    Contractor.belongsTo(db.Category, { as: 'category', foreignKey: 'categoryId', onDelete: 'SET NULL' });
    db.Category.hasMany(Contractor, { foreignKey: 'categoryId' });
  };

  return Contractor;
};
