'use strict';

module.exports = (sequelize, DataTypes) => {
  // Rol: qaysi bo'limlarga kirish va qanday amallar mumkinligi. permissions = { bo'lim: ['view', 'create', ...] }
  const Role = sequelize.define('Role', {
    name: { type: DataTypes.STRING, allowNull: false },
    permissions: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  }, {
    // Tashkilot ichida noyob (har mijozda o'z "name" lari)
    indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
  });

  Role.associate = (db) => {
    db.User.belongsTo(Role, { as: 'role', foreignKey: 'roleId', onDelete: 'SET NULL' });
    Role.hasMany(db.User, { foreignKey: 'roleId' });
  };

  return Role;
};
