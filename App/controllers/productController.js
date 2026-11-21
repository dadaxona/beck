const { Op, fn, col } = require('sequelize');
const { sequelize, Product, ProductCategory, StockBalance, ReceiptItem, SaleItem, SaleReturnItem, WriteOff, OrderItem } = require('../../models');
const images = require('../services/productImages');

const FIELDS = ['name', 'barcode', 'purchasePrice', 'wholesalePrice', 'retailPrice', 'categoryId', 'unit'];
// O'lchov birliklari (ekranda tarjima qilinadi: dona/шт, kg/кг, gr/гр, m/м, l/л, qadoq/уп)
const UNITS = ['pcs', 'kg', 'g', 'm', 'l', 'pack'];

const include = [{ model: ProductCategory, as: 'category', attributes: ['id', 'name'] }];

const pick = (body) => {
  const data = {};
  for (const key of FIELDS) if (body[key] !== undefined) data[key] = body[key];
  for (const key of ['purchasePrice', 'wholesalePrice', 'retailPrice']) {
    if (key in data) data[key] = Number(data[key]) || 0;
  }
  if ('name' in data) data.name = String(data.name).trim();
  if ('barcode' in data) data.barcode = String(data.barcode).trim();
  if ('categoryId' in data) data.categoryId = Number(data.categoryId) || null;
  if ('unit' in data) data.unit = UNITS.includes(data.unit) ? data.unit : 'pcs';
  return data;
};

const checkCategory = async (categoryId) => {
  if (categoryId && !(await ProductCategory.findByPk(categoryId))) {
    const err = new Error('Kategoriya topilmadi');
    err.status = 404;
    throw err;
  }
};

exports.list = async (req, res) => {
  const { q, categoryId, includeDeleted, warehouseId } = req.query;
  const where = {};

  // O'chirishga belgilanganlar faqat so'ralganda (boshqaruv ro'yxati); tanlash oynalarida chiqmaydi
  if (!includeDeleted) where.deleted = false;

  if (categoryId === 'none') where.categoryId = null;
  else if (categoryId) where.categoryId = Number(categoryId);

  if (q) {
    const like = { [Op.like]: `%${q}%` };
    where[Op.or] = [{ name: like }, { barcode: like }];
  }

  const [products, stocks] = await Promise.all([
    Product.findAll({ where, include, order: [['name', 'ASC']] }),
    StockBalance.findAll({
      // warehouseId berilsa - faqat shu ombordagi qoldiq (sotuv oynasi uchun)
      where: warehouseId ? { warehouseId: Number(warehouseId) } : {},
      attributes: ['productId', [fn('SUM', col('quantity')), 'quantity']],
      group: ['productId'],
      raw: true,
    }),
  ]);

  const stockOf = new Map(stocks.map((s) => [s.productId, Number(s.quantity)]));
  res.json(products.map((p) => ({ ...p.toJSON(), stock: stockOf.get(p.id) || 0 })));
};

exports.create = async (req, res) => {
  const data = pick(req.body || {});
  if (!data.name) return res.status(400).json({ message: 'Tovar nomini kiriting' });
  await checkCategory(data.categoryId);

  const product = await Product.create(data);
  res.status(201).json({ ...(await Product.findByPk(product.id, { include })).toJSON(), stock: 0 });
};

exports.update = async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ message: 'Tovar topilmadi' });

  const data = pick(req.body || {});
  if ('name' in data && !data.name) return res.status(400).json({ message: 'Tovar nomini kiriting' });
  await checkCategory(data.categoryId);

  await product.update(data);
  res.json((await Product.findByPk(product.id, { include })).toJSON());
};

// O'chirishga belgilash (X): ro'yxatda qoladi, qidiruv/sotuv/kirimda chiqmaydi, ombor qiymatiga kirmaydi
exports.remove = async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ message: 'Tovar topilmadi' });
  await product.update({ deleted: true });
  res.json({ ok: true });
};

exports.restore = async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ message: 'Tovar topilmadi' });
  await product.update({ deleted: false });
  res.json({ ok: true });
};

// Butunlay o'chirish (hujjatlarda ishlatilmagan bo'lsa)
exports.purge = async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ message: 'Tovar topilmadi' });

  if (
    (await ReceiptItem.findOne({ where: { productId: product.id } })) ||
    (await SaleItem.findOne({ where: { productId: product.id } })) ||
    (await SaleReturnItem.findOne({ where: { productId: product.id } })) ||
    (await WriteOff.findOne({ where: { productId: product.id } })) ||
    (await OrderItem.findOne({ where: { productId: product.id } }))
  ) {
    return res.status(409).json({ message: "Tovar hujjatlarda ishlatilgan, o'chirib bo'lmaydi" });
  }

  await sequelize.transaction(async (t) => {
    await StockBalance.destroy({ where: { productId: product.id }, transaction: t });
    await product.destroy({ transaction: t });
  });
  images.remove(product.image);
  res.json({ ok: true });
};

// Belgilangan tovarlarni kategoriyaga biriktirish (categoryId: null -> kategoriyadan chiqarish)
exports.assign = async (req, res) => {
  const { ids, categoryId } = req.body || {};

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ message: 'Tovarlarni belgilang' });
  }
  await checkCategory(categoryId);

  const [count] = await Product.update({ categoryId: categoryId || null }, { where: { id: ids } });
  res.json({ updated: count });
};

// Rasm yuklash: { data: "data:image/jpeg;base64,..." } (brauzer rasmni oldindan kichraytirib yuboradi)
exports.uploadImage = async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ message: 'Tovar topilmadi' });
  const url = images.save(product.id, (req.body || {}).data);
  const old = product.image;
  await product.update({ image: url });
  images.remove(old);
  res.json((await Product.findByPk(product.id, { include })).toJSON());
};

exports.removeImage = async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ message: 'Tovar topilmadi' });
  const old = product.image;
  await product.update({ image: null });
  images.remove(old);
  res.json((await Product.findByPk(product.id, { include })).toJSON());
};
