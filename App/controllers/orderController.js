const { Op } = require('sequelize');
const { Order } = require('../../models');
const orders = require('../services/orders');
const telegram = require('../services/telegram');

const OPEN = ['new', 'seen'];

/**
 * GET /orders?source=client|employee&status=open|sold|cancelled|all
 * Standart: ochiq zakazlar (yangi va ko'rilgan) - hali sotuvga olinmaganlar.
 */
exports.list = async (req, res) => {
  const where = {};
  if (req.query.source === 'client' || req.query.source === 'employee') where.source = req.query.source;
  const status = req.query.status || 'open';
  if (status === 'open') where.status = { [Op.in]: OPEN };
  else if (status !== 'all') where.status = status;
  res.json(await orders.list(where));
};

/** GET /orders/summary - qo'ng'iroq yonidagi tugmalar uchun: yangi va ochiq zakazlar soni, oxirgi zakaz */
exports.summary = async (req, res) => {
  const out = {};
  for (const source of ['client', 'employee']) {
    const [fresh, open, last] = await Promise.all([
      Order.count({ where: { source, status: 'new' } }),
      Order.count({ where: { source, status: { [Op.in]: OPEN } } }),
      Order.findOne({ where: { source }, order: [['id', 'DESC']], attributes: ['id', 'number', 'customerName', 'total', 'currency', 'status'] }),
    ]);
    out[source] = { new: fresh, open, last: last ? last.toJSON() : null };
  }
  res.json(out);
};

/** GET /orders/mine - xodimning o'zi bergan zakazlari (mini app) */
exports.mine = async (req, res) => {
  res.json(await orders.list({ userId: req.user.id }, 100));
};

exports.get = async (req, res) => {
  const order = await orders.load(Number(req.params.id));
  if (!order) return res.status(404).json({ message: 'Zakaz topilmadi' });
  // "Zakazlar → ko'rish" ruxsati bo'lmagan xodim faqat o'z zakazini ko'radi
  const canView = (req.user.permissions.orders || []).includes('view');
  if (!canView && order.userId !== req.user.id) {
    return res.status(403).json({ message: "Bu amal uchun ruxsat yo'q" });
  }
  res.json(order);
};

/** POST /orders - xodimlar mini app'idan zakaz (sotuv emas!) */
exports.create = async (req, res) => {
  const b = req.body || {};
  const order = await orders.create({
    source: 'employee',
    customerName: b.customerName,
    phone: b.phone,
    address: b.address,
    comment: b.comment,
    contractorId: b.contractorId,
    priceType: b.priceType,
    items: b.items,
    userId: req.user.id,
  });
  res.status(201).json(order);
};

/** POST /orders/:id/seen - zakaz ko'rildi (yangi -> ko'rilgan) */
exports.seen = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ message: 'Zakaz topilmadi' });
  if (order.status === 'new') await order.update({ status: 'seen' });
  res.json({ ok: true });
};

/** POST /orders/:id/cancel - bekor qilish (sotilgani bekor qilinmaydi) */
exports.cancel = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ message: 'Zakaz topilmadi' });
  if (order.status === 'sold') return res.status(409).json({ message: 'Sotilgan zakazni bekor qilib bo\'lmaydi' });
  await order.update({ status: 'cancelled' });
  if (order.source === 'client' && order.telegramId) {
    telegram.notify('client', order.telegramId, `Zakazingiz ${order.number} bekor qilindi.`);
  }
  res.json({ ok: true });
};

/** POST /orders/:id/restore - bekor qilinganni qayta ochish */
exports.restore = async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ message: 'Zakaz topilmadi' });
  if (order.status === 'cancelled') await order.update({ status: 'seen' });
  res.json({ ok: true });
};
