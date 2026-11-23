'use strict';

// Kassa (1C dagi "Кассир": Naqd, Plastik, Buxgalteriya...)
module.exports = (sequelize, DataTypes) => {
  const CashDesk = sequelize.define('CashDesk', {
    name: { type: DataTypes.STRING, allowNull: false },
  }, {
    // Tashkilot ichida noyob (har mijozda o'z "name" lari)
    indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
  });

  return CashDesk;
};
