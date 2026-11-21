const { Op } = require('sequelize');
const { Warehouse, StockBalance, Sale, Receipt, SaleReturn, WriteOff, StockTransfer } = require('../../models');

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Standart ombor: birinchi yaratilgani ("Asosiy"). Uni o'chirib bo'lmaydi. */
const defaultId = async () => {
  const w = await Warehouse.findOne({ order: [['id', 'ASC']], attributes: ['id'] });
  return w ? w.id : null;
};

exports.list = async (req, res) => {
  const [rows, def] = await Promise.all([Warehouse.findAll({ order: [['id', 'ASC']] }), defaultId()]);
  res.json(rows.map((w) => ({ ...w.toJSON(), isDefault: w.id === def })));
};

const cleanName = (v) => String(v == null ? '' : v).trim().slice(0, 100);

exports.create = async (req, res) => {
  const name = cleanName((req.body || {}).name);
  if (!name) throw fail(400, 'Ombor nomini kiriting');
  if (await Warehouse.findOne({ where: { name } })) throw fail(409, 'Bunday ombor mavjud');
  const w = await Warehouse.create({ name });
  res.status(201).json({ ...w.toJSON(), isDefault: false });
};

exports.update = async (req, res) => {
  const w = await Warehouse.findByPk(req.params.id);
  if (!w) throw fail(404, 'Ombor topilmadi');
  const name = cleanName((req.body || {}).name);
  if (!name) throw fail(400, 'Ombor nomini kiriting');
  if (await Warehouse.findOne({ where: { name, id: { [Op.ne]: w.id } } })) throw fail(409, 'Bunday ombor mavjud');
  await w.update({ name });
  res.json({ ...w.toJSON(), isDefault: w.id === (await defaultId()) });
};

// Standart ombor, qoldig'i bor yoki hujjatlarda ishlatilgan ombor o'chirilmaydi
exports.remove = async (req, res) => {
  const w = await Warehouse.findByPk(req.params.id);
  if (!w) throw fail(404, 'Ombor topilmadi');
  if (w.id === (await defaultId())) throw fail(400, "Asosiy (standart) omborni o'chirib bo'lmaydi");

  const stock = await StockBalance.findOne({ where: { warehouseId: w.id, quantity: { [Op.or]: [{ [Op.gt]: 0.0001 }, { [Op.lt]: -0.0001 }] } } });
  if (stock) throw fail(409, "Omborda tovar qoldig'i bor. Avval tovarlarni boshqa omborga ko'chiring");

  const used =
    (await Sale.findOne({ where: { warehouseId: w.id }, attributes: ['id'] })) ||
    (await Receipt.findOne({ where: { warehouseId: w.id }, attributes: ['id'] })) ||
    (await SaleReturn.findOne({ where: { warehouseId: w.id }, attributes: ['id'] })) ||
    (await WriteOff.findOne({ where: { warehouseId: w.id }, attributes: ['id'] })) ||
    (await StockTransfer.findOne({ where: { [Op.or]: [{ fromWarehouseId: w.id }, { toWarehouseId: w.id }] }, attributes: ['id'] }));
  if (used) throw fail(409, "Ombor hujjatlarda ishlatilgan, o'chirib bo'lmaydi");

  await StockBalance.destroy({ where: { warehouseId: w.id } });
  await w.destroy();
  res.json({ ok: true });
};
