'use strict';

/**
 * Zakazlar (Telegram mini app'lardan). Zakaz ombor qoldig'i va kassaga ta'sir qilmaydi:
 * sotuv faqat kompyuterdagi Sotuv oynasida kassir tomonidan qilinadi.
 */
const { sequelize, Order, OrderItem, Product, Contractor, User, StockBalance } = require('../../models');
const numbering = require('./numbering');
const { fn, col } = require('sequelize');
const { today } = require('../utils/date');
const currencies = require('./currencies');

const fail = (status, message) => Object.assign(new Error(message), { status });
const round = (v) => Math.round(v * 100) / 100;
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const include = [
  { model: Contractor, as: 'contractor', attributes: ['id', 'name', 'phones', 'blacklisted'] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
  {
    model: OrderItem,
    as: 'items',
    include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'barcode', 'unit', 'image', 'wholesalePrice', 'retailPrice', 'currency'] }],
  },
];
const order = [['id', 'DESC']];
// Qatorlar tartibi JS da (limit + hasMany include bilan SQL tartiblash ishonchsiz)
const plain = (o) => {
  const j = o.toJSON();
  j.items = (j.items || []).sort((a, b) => a.id - b.id);
  return j;
};

/** Barcha omborlar bo'yicha qoldiq: Map(productId -> soni) */
async function stockMap(productIds) {
  const where = productIds ? { productId: productIds } : {};
  const rows = await StockBalance.findAll({
    where,
    attributes: ['productId', [fn('SUM', col('quantity')), 'quantity']],
    group: ['productId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.productId, Number(r.quantity) || 0]));
}

/**
 * Zakaz yaratish.
 *  source: client | employee
 *  items: [{ productId, quantity, price? }]  (mijoz narx bermaydi: sotish narxi olinadi)
 */
async function create(input) {
  const source = input.source === 'employee' ? 'employee' : 'client';
  const customerName = clean(input.customerName, 120);
  const phone = clean(input.phone, 40);
  const address = clean(input.address, 500);
  const comment = clean(input.comment, 1000);
  if (!customerName) throw fail(400, 'Ismni kiriting');
  if (phone.replace(/\D/g, '').length < 9) throw fail(400, 'Telefon raqamini kiriting');
  if (!address) throw fail(400, 'Manzilni kiriting');

  const raw = Array.isArray(input.items) ? input.items : [];
  const merged = new Map();
  for (const i of raw) {
    const productId = Number(i && i.productId);
    const quantity = Number(i && i.quantity) || 0;
    if (!productId || quantity <= 0) throw fail(400, "Soni 0 dan katta bo'lishi kerak");
    if (quantity > 100000) throw fail(400, 'Soni juda katta');
    const prev = merged.get(productId);
    merged.set(productId, { productId, quantity: round((prev ? prev.quantity : 0) + quantity), price: i.price });
  }
  if (!merged.size) throw fail(400, "Tovar qo'shing");
  if (merged.size > 300) throw fail(400, "Tovarlar soni juda ko'p");

  const priceType = source === 'employee' && input.priceType === 'wholesale' ? 'wholesale' : 'retail';

  let contractorId = null;
  if (source === 'employee' && input.contractorId) {
    const c = await Contractor.findByPk(Number(input.contractorId));
    if (!c || c.deleted) throw fail(400, 'Mijoz topilmadi');
    if (c.blacklisted) throw fail(400, `Qora ro'yxatdagi mijoz: ${c.name}`);
    contractorId = c.id;
  }

  const id = await sequelize.transaction(async (t) => {
    const products = await Product.findAll({ where: { id: [...merged.keys()] }, transaction: t });
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = [];
    // Zakaz so'mda: tovar o'z valyutasida bo'lsa hozirgi kurs bo'yicha o'giriladi
    const rates = await currencies.rates();
    const uzs = (amount, cur) => (!cur || cur === 'UZS' ? amount : Math.round(amount * (rates[cur] || 1) * 100) / 100);
    for (const i of merged.values()) {
      const p = byId.get(i.productId);
      if (!p || p.deleted) throw fail(400, 'Tovar topilmadi');
      const wholesale = uzs(p.wholesalePrice, p.currency);
      const base = uzs(priceType === 'wholesale' ? p.wholesalePrice : p.retailPrice, p.currency);
      let price = base;
      // Xodim narxni o'zgartirishi mumkin, lekin diller narxidan past emas
      if (source === 'employee' && i.price !== undefined && i.price !== null && i.price !== '') {
        price = Number(i.price) || 0;
        if (price < wholesale - 0.005) {
          throw fail(400, `Diller narxidan arzon bo'lishi mumkin emas: ${p.name} (diller narxi: ${wholesale})`);
        }
      }
      if (price <= 0) throw fail(400, `Tovar narxi belgilanmagan: ${p.name}`);
      lines.push({ productId: p.id, quantity: i.quantity, price, sum: round(i.quantity * price) });
    }

    const record = await Order.create(
      {
        date: today(),
        source,
        status: 'new',
        customerName,
        phone,
        address,
        comment,
        priceType,
        total: round(lines.reduce((s, l) => s + l.sum, 0)),
        telegramId: input.telegramId ? String(input.telegramId) : null,
        telegramName: clean(input.telegramName, 120),
        contractorId,
        userId: input.userId || null,
      },
      { transaction: t },
    );
    await record.update({ number: `Z-${await numbering.next('Order', t)}` }, { transaction: t });
    await OrderItem.bulkCreate(lines.map((l) => ({ ...l, orderId: record.id })), { transaction: t });
    return record.id;
  });

  return load(id);
}

async function load(id) {
  const o = await Order.findByPk(id, { include, order });
  return o ? plain(o) : null;
}

async function list(where = {}, limit = 200) {
  const rows = await Order.findAll({ where, include, order, limit });
  return rows.map(plain);
}

/** Sotuv qabul qilinganda: zakaz "sotildi" (transaction ichida, sotuv bilan birga) */
async function markSold(orderId, saleId, transaction) {
  const o = await Order.findByPk(orderId, { transaction });
  if (!o) throw fail(404, 'Zakaz topilmadi');
  if (o.status === 'sold') throw fail(409, `Zakaz ${o.number} allaqachon sotilgan`);
  if (o.status === 'cancelled') throw fail(409, `Zakaz ${o.number} bekor qilingan`);
  await o.update({ status: 'sold', saleId }, { transaction });
  return o;
}

module.exports = { create, load, list, markSold, stockMap, include };
