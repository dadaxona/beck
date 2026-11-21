'use strict';

/**
 * Tovarlarni Excel (.xlsx) dan import va Excel ga export.
 *
 * Ustunlar (birinchi qatorda sarlavha; tartibi ixtiyoriy, ruscha yoki o'zbekcha nom):
 *   Название | Штрихкод | Категория | Цена продажи | Цена закупки | Цена оптом | Остаток
 *
 * Import:
 *  - tovar shtrix-kod bo'yicha, shtrix-kod bo'lmasa nomi bo'yicha topiladi; topilmasa yangisi yaratiladi;
 *  - kategoriya yo'q bo'lsa yaratiladi;
 *  - "Остаток" tanlangan ombordagi qoldiqqa tenglashtiriladi: farq hujjat bilan yoziladi
 *    (ko'paysa - "Tovar kirimi", kamaysa - "Qaytarish"; yetkazib beruvchisiz, shuning uchun qarz yozilmaydi).
 *    Kataklar bo'sh bo'lsa qoldiq o'zgarmaydi.
 *  - Avval rejasi ko'rsatiladi (dryRun), tasdiqlansa bitta tranzaksiyada qo'llanadi.
 */

const ExcelJS = require('exceljs');
const {
  sequelize, Product, ProductCategory, StockBalance, Receipt, ReceiptItem, Warehouse,
} = require('../../models');
const { today } = require('../utils/date');
const { EPS, roundQty, roundMoney } = require('../utils/qty');

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Export sarlavhalari (rasmda ko'rsatilgan tartibda) */
const COLUMNS = [
  { key: 'name', header: 'Название', width: 46 },
  { key: 'barcode', header: 'Штрихкод', width: 22 },
  { key: 'category', header: 'Категория', width: 26 },
  { key: 'retail', header: 'Цена продажи', width: 16 },
  { key: 'purchase', header: 'Цена закупки', width: 16 },
  { key: 'wholesale', header: 'Цена оптом', width: 16 },
  { key: 'stock', header: 'Остаток', width: 11 },
];

/** Importda qabul qilinadigan sarlavha nomlari (kichik harf, bo'shliqlarsiz) */
const ALIASES = {
  name: ['название', 'наименование', 'товар', 'nomi', 'nom', 'tovar', 'tovarnomi', 'name'],
  barcode: ['штрихкод', 'штрих-код', 'шк', 'shtrixkod', 'shtrix-kod', 'barcode'],
  category: ['категория', 'группа', 'kategoriya', 'guruh', 'category'],
  retail: ['ценапродажи', 'розничнаяцена', 'цена', 'sotishnarxi', 'retail', 'price'],
  purchase: ['ценазакупки', 'закупочнаяцена', 'себестоимость', 'olishnarxi', 'purchase', 'cost'],
  wholesale: ['ценаоптом', 'оптоваяцена', 'опт', 'дилерскаяцена', 'dillernarxi', 'optom', 'wholesale'],
  stock: ['остаток', 'количество', 'кол-во', 'qoldiq', 'soni', 'stock', 'qty'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_.]/g, '');

/** Katak qiymatini oddiy qiymatga aylantiradi (formula natijasi, boy matn, giperhavola) */
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return cellValue(v.text);
    if ('error' in v) return null;
  }
  return v;
}

const text = (v) => {
  const c = cellValue(v);
  if (c === null) return '';
  if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(c);
  return String(c).replace(/ /g, ' ').trim();
};

/** "625 000", "1 250,50", 625000 -> son; bo'sh -> null; noto'g'ri -> NaN */
function number(v) {
  const c = cellValue(v);
  if (c === null || c === '') return null;
  if (typeof c === 'number') return c;
  const s = String(c).replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Excel faylini o'qiydi: [{ row, name, barcode, category, retail, purchase, wholesale, stock }] */
async function readRows(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw fail(400, "Faylni o'qib bo'lmadi. Excel (.xlsx) faylini tanlang");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw fail(400, "Faylda varaq yo'q");

  // Sarlavha qatori: dastlabki 10 qatordan "Название"/"Nomi" bor birinchisi
  let headerRow = 0;
  const map = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const row = ws.getRow(r);
    const found = {};
    row.eachCell((cell, col) => {
      const h = norm(text(cell.value));
      for (const [key, names] of Object.entries(ALIASES)) {
        if (!(key in found) && names.includes(h)) found[key] = col;
      }
    });
    if ('name' in found) {
      headerRow = r;
      Object.assign(map, found);
    }
  }
  if (!headerRow) throw fail(400, 'Sarlavha topilmadi: birinchi qatorda "Название" (yoki "Nomi") ustuni bo\'lishi kerak');

  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (key) => (key in map ? row.getCell(map[key]).value : null);
    const item = {
      row: r,
      name: text(get('name')),
      barcode: text(get('barcode')),
      category: text(get('category')),
      retail: number(get('retail')),
      purchase: number(get('purchase')),
      wholesale: number(get('wholesale')),
      stock: 'stock' in map ? number(get('stock')) : null,
      hasCategory: 'category' in map,
    };
    const empty = !item.name && !item.barcode && !item.category && [item.retail, item.purchase, item.wholesale, item.stock].every((v) => v === null);
    if (!empty) rows.push(item);
  }
  return rows;
}

/**
 * Import rejasi: nima yaratiladi, nima o'zgaradi, qoldiq qancha o'zgaradi va qaysi qatorlarda xato bor.
 * Bazaga hech narsa yozmaydi.
 */
async function plan(rows, warehouseId) {
  const [products, categories, balances] = await Promise.all([
    Product.findAll({ raw: true }),
    ProductCategory.findAll({ raw: true }),
    StockBalance.findAll({ where: { warehouseId }, raw: true }),
  ]);
  const byBarcode = new Map();
  const byName = new Map();
  for (const p of products) {
    if (p.barcode) byBarcode.set(p.barcode.trim().toLowerCase(), p);
    byName.set(p.name.trim().toLowerCase(), p);
  }
  const catByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  const stockOf = new Map(balances.map((b) => [b.productId, b.quantity]));

  const errors = [];
  const newCategories = new Map(); // kichik harf -> asl nom
  const entries = new Map(); // fayl ichida bir tovar bir necha marta bo'lsa oxirgisi olinadi

  for (const r of rows) {
    if (!r.name) {
      errors.push({ row: r.row, message: "Tovar nomi bo'sh" });
      continue;
    }
    const bad = ['retail', 'purchase', 'wholesale', 'stock'].find((k) => Number.isNaN(r[k]) || (r[k] !== null && r[k] < 0));
    if (bad) {
      errors.push({ row: r.row, message: `Noto'g'ri son: ${COLUMNS.find((c) => c.key === bad).header}` });
      continue;
    }

    const existing =
      (r.barcode && byBarcode.get(r.barcode.toLowerCase())) || byName.get(r.name.toLowerCase()) || null;
    const key = existing ? `p${existing.id}` : `n:${(r.barcode || r.name).toLowerCase()}`;

    const catKey = r.category.toLowerCase();
    if (r.category && !catByName.has(catKey)) newCategories.set(catKey, r.category);

    entries.set(key, { ...r, product: existing });
  }

  const items = [];
  for (const e of entries.values()) {
    const p = e.product;
    const next = {
      name: e.name,
      barcode: e.barcode || (p ? p.barcode : ''),
      retailPrice: e.retail ?? (p ? p.retailPrice : 0),
      purchasePrice: e.purchase ?? (p ? p.purchasePrice : 0),
      wholesalePrice: e.wholesale ?? (p ? p.wholesalePrice : 0),
      categoryName: e.hasCategory ? e.category : null, // null = o'zgarmaydi
    };
    const currentCat = p && p.categoryId ? categories.find((c) => c.id === p.categoryId) : null;
    const catChanged = e.hasCategory && (currentCat ? currentCat.name.toLowerCase() : '') !== e.category.toLowerCase();
    const changed =
      !p ||
      p.deleted ||
      p.name !== next.name ||
      p.barcode !== next.barcode ||
      Math.abs(p.retailPrice - next.retailPrice) > 0.005 ||
      Math.abs(p.purchasePrice - next.purchasePrice) > 0.005 ||
      Math.abs(p.wholesalePrice - next.wholesalePrice) > 0.005 ||
      catChanged;

    const current = p ? stockOf.get(p.id) || 0 : 0;
    const delta = e.stock === null ? 0 : roundQty(e.stock - current);
    items.push({ row: e.row, product: p, next, status: !p ? 'new' : changed ? 'updated' : 'same', stock: e.stock, current, delta });
  }

  const sum = (f) => roundQty(items.reduce((s, i) => s + f(i), 0));
  return {
    items,
    newCategories: [...newCategories.values()],
    errors,
    summary: {
      rows: rows.length,
      created: items.filter((i) => i.status === 'new').length,
      updated: items.filter((i) => i.status === 'updated').length,
      unchanged: items.filter((i) => i.status === 'same').length,
      stockIn: sum((i) => (i.delta > 0 ? i.delta : 0)),
      stockOut: sum((i) => (i.delta < 0 ? -i.delta : 0)),
      stockChanged: items.filter((i) => Math.abs(i.delta) > EPS).length,
    },
  };
}

/** Rejani bitta tranzaksiyada qo'llaydi */
async function apply(p, warehouseId, userId) {
  return sequelize.transaction(async (t) => {
    // 1) Kategoriyalar
    const cats = new Map((await ProductCategory.findAll({ transaction: t })).map((c) => [c.name.trim().toLowerCase(), c]));
    for (const name of p.newCategories) {
      if (!cats.has(name.toLowerCase())) cats.set(name.toLowerCase(), await ProductCategory.create({ name }, { transaction: t }));
    }

    // 2) Tovarlar
    const docs = { in: [], out: [] };
    for (const item of p.items) {
      const data = {
        name: item.next.name,
        barcode: item.next.barcode,
        retailPrice: roundMoney(item.next.retailPrice),
        purchasePrice: roundMoney(item.next.purchasePrice),
        wholesalePrice: roundMoney(item.next.wholesalePrice),
        deleted: false,
      };
      if (item.next.categoryName !== null) {
        data.categoryId = item.next.categoryName ? cats.get(item.next.categoryName.toLowerCase()).id : null;
      }
      let productId;
      if (item.product) {
        if (item.status !== 'same') await Product.update(data, { where: { id: item.product.id }, transaction: t });
        productId = item.product.id;
      } else {
        productId = (await Product.create(data, { transaction: t })).id;
      }

      // 3) Qoldiq farqi
      if (Math.abs(item.delta) > EPS) {
        const line = {
          productId,
          quantity: Math.abs(item.delta),
          purchasePrice: data.purchasePrice,
          prevPurchasePrice: item.product ? item.product.purchasePrice : 0,
          wholesalePrice: data.wholesalePrice,
          retailPrice: data.retailPrice,
          sum: roundMoney(Math.abs(item.delta) * data.purchasePrice),
        };
        (item.delta > 0 ? docs.in : docs.out).push(line);
        const [balance] = await StockBalance.findOrCreate({
          where: { productId, warehouseId },
          defaults: { quantity: 0 },
          transaction: t,
        });
        await balance.update({ quantity: roundQty(item.stock) }, { transaction: t });
      }
    }

    // 4) Qoldiq o'zgarishi hujjat bilan (Kirim jurnalida ko'rinadi; yetkazib beruvchisiz -> qarz yozilmaydi)
    const created = [];
    for (const [type, lines, prefix, note] of [
      ['receipt', docs.in, 'KR', "Excel import: qoldiq (kirim)"],
      ['return', docs.out, 'QR', "Excel import: qoldiq (kamaytirish)"],
    ]) {
      if (!lines.length) continue;
      const doc = await Receipt.create(
        {
          type,
          number: '',
          date: today(),
          warehouseId,
          currency: 'UZS',
          note,
          total: roundMoney(lines.reduce((s, l) => s + l.sum, 0)),
          posted: true,
          userId,
        },
        { transaction: t },
      );
      await doc.update({ number: `${prefix}-${doc.id}` }, { transaction: t });
      await ReceiptItem.bulkCreate(lines.map((l) => ({ ...l, receiptId: doc.id })), { transaction: t });
      created.push(doc.number);
    }
    return created;
  });
}

async function importFile(buffer, warehouseId, dryRun, userId) {
  if (!(await Warehouse.findByPk(warehouseId))) throw fail(400, 'Omborni tanlang');
  const rows = await readRows(buffer);
  if (!rows.length) throw fail(400, "Faylda tovar qatorlari yo'q");
  const p = await plan(rows, warehouseId);

  const result = {
    summary: p.summary,
    newCategories: p.newCategories,
    errors: p.errors,
    // Ko'rib chiqish uchun dastlabki o'zgarishlar
    preview: p.items
      .filter((i) => i.status !== 'same' || Math.abs(i.delta) > EPS)
      .slice(0, 200)
      .map((i) => ({ row: i.row, name: i.next.name, status: i.status, current: i.current, stock: i.stock, delta: i.delta })),
  };
  if (dryRun) return { ...result, applied: false };
  if (p.errors.length) throw fail(400, "Faylda xatolar bor. Avval ularni tuzating");
  const documents = await apply(p, warehouseId, userId);
  return { ...result, applied: true, documents };
}

/** Barcha (o'chirilmagan) tovarlar: rasmdagi ustunlar bilan .xlsx */
async function exportFile(warehouseId) {
  const [products, categories, balances] = await Promise.all([
    Product.findAll({ where: { deleted: false }, order: [['name', 'ASC']], raw: true }),
    ProductCategory.findAll({ raw: true }),
    StockBalance.findAll({ where: warehouseId ? { warehouseId } : {}, raw: true }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const stock = new Map();
  for (const b of balances) stock.set(b.productId, (stock.get(b.productId) || 0) + b.quantity);

  const wb = new ExcelJS.Workbook();
  wb.creator = '2C';
  const ws = wb.addWorksheet('Tovarlar', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getColumn('barcode').numFmt = '@'; // shtrix-kod matn bo'lib qolsin (uzun raqamlar buzilmasin)
  for (const key of ['retail', 'purchase', 'wholesale']) ws.getColumn(key).numFmt = '#,##0';
  ws.getColumn('stock').numFmt = '#,##0.###';

  for (const p of products) {
    ws.addRow({
      name: p.name,
      barcode: p.barcode || '',
      category: p.categoryId ? catName.get(p.categoryId) || '' : '',
      retail: p.retailPrice,
      purchase: p.purchasePrice,
      wholesale: p.wholesalePrice,
      stock: roundQty(stock.get(p.id) || 0),
    });
  }
  ws.autoFilter = { from: 'A1', to: 'G1' };
  return wb.xlsx.writeBuffer();
}

module.exports = { importFile, exportFile, readRows, COLUMNS };
