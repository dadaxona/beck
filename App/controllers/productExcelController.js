const { Warehouse } = require('../../models');
const excel = require('../services/productExcel');
const { today } = require('../utils/date');

const firstWarehouseId = async () => (await Warehouse.findOne({ order: [['id', 'ASC']] }))?.id;

// POST /products/import  { file: base64 (.xlsx), warehouseId, dryRun }
// dryRun=true: faqat reja (nima yaratiladi/o'zgaradi), bazaga yozmaydi
exports.import = async (req, res) => {
  const b = req.body || {};
  if (!b.file) return res.status(400).json({ message: 'Faylni tanlang' });
  const buffer = Buffer.from(String(b.file).replace(/^data:.*?;base64,/, ''), 'base64');
  const warehouseId = Number(b.warehouseId) || (await firstWarehouseId());
  res.json(await excel.importFile(buffer, warehouseId, b.dryRun !== false, req.user.id));
};

// GET /products/export?warehouseId=  (bo'lmasa barcha omborlar bo'yicha qoldiq)
exports.export = async (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const buffer = await excel.exportFile(warehouseId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tovarlar-${today()}.xlsx"`);
  res.send(Buffer.from(buffer));
};
