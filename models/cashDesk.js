'use strict';

// Kassa (1C dagi "Кассир": Naqd, Plastik, Buxgalteriya...)
module.exports = (sequelize, DataTypes) => {
  const CashDesk = sequelize.define('CashDesk', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
  });

  return CashDesk;
};
