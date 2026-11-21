'use strict';

module.exports = (sequelize, DataTypes) => {
  const PayrollItem = sequelize.define('PayrollItem', {
    amount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  });

  PayrollItem.associate = (db) => {
    PayrollItem.belongsTo(db.Payroll, { foreignKey: 'payrollId', onDelete: 'CASCADE' });
    PayrollItem.belongsTo(db.Contractor, { as: 'contractor', foreignKey: 'contractorId', onDelete: 'RESTRICT' });
  };

  return PayrollItem;
};
