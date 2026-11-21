'use strict';

module.exports = (sequelize, DataTypes) => {
  const price = () => ({ type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 });

  const Product = sequelize.define('Product', {
    name: { type: DataTypes.STRING, allowNull: false },
    barcode: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    purchasePrice: price(),  // Olish narxi (oxirgi kirim)
    wholesalePrice: price(), // Diller narxi (eng past sotish narxi)
    retailPrice: price(),    // Sotish narxi
    unit: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pcs' }, // O'lchov birligi: pcs | kg | g | m | l | pack
    image: { type: DataTypes.STRING, allowNull: true }, // Rasm: /uploads/products/... (mini app va tovarlar ro'yxatida)
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // o'chirishga belgilangan (1C dagi X): hisob-kitobda qatnashmaydi, ro'yxatda qoladi
  });

  return Product;
};
