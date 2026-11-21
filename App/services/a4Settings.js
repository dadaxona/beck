'use strict';

/**
 * A4 hujjat (sotuv natijasi) sozlamalari: Sozlamalar → "A4 hujjat". Bazada "a4" kaliti ostida.
 *
 * Sahifa 210 x 297 mm. Doimiy ma'lumotlar (logo, tashkilot nomi, manzil, telefon, rekvizitlar, sarlavha,
 * sana, mijoz ...) bloklar sifatida istalgan joyga suriladi (x, y, eni mm da) va katakcha bilan
 * yoqiladi / o'chiriladi. Tovarlar jadvali (nomi, soni, summasi) "tableTop" dan boshlanadi, uning
 * ostida jami, chegirma (bo'lsa), qarz (bo'lsa) va boshqa yoqilgan qismlar chiqadi.
 */
const { Setting } = require('../../models');

const KEY = 'a4';

/** Suriladigan bloklar va ularning standart joyi */
const BLOCKS = {
  logo: { show: true, x: 12, y: 10, w: 32, size: 10, bold: false, align: 'left' },
  org: { show: true, x: 50, y: 11, w: 100, size: 16, bold: true, align: 'left' },
  address: { show: true, x: 50, y: 19, w: 100, size: 9, bold: false, align: 'left' },
  phones: { show: true, x: 50, y: 24, w: 100, size: 9, bold: false, align: 'left' },
  requisites: { show: false, x: 140, y: 11, w: 58, size: 8, bold: false, align: 'right' },
  title: { show: true, x: 12, y: 44, w: 186, size: 15, bold: true, align: 'center' },
  date: { show: true, x: 12, y: 54, w: 90, size: 10, bold: false, align: 'left' },
  client: { show: true, x: 12, y: 60, w: 110, size: 10, bold: false, align: 'left' },
  cashier: { show: true, x: 120, y: 54, w: 78, size: 10, bold: false, align: 'right' },
  warehouse: { show: false, x: 120, y: 60, w: 78, size: 10, bold: false, align: 'right' },
  custom1: { show: false, x: 12, y: 32, w: 186, size: 9, bold: false, align: 'left' },
  custom2: { show: false, x: 12, y: 37, w: 186, size: 9, bold: false, align: 'left' },
};

const DEFAULTS = {
  tableTop: 70, // mm: tovarlar jadvali shu joydan boshlanadi
  logo: '', // data:image/...;base64 (Sozlamalarda yuklanadi)
  texts: {
    address: '',
    phones: '',
    requisites: '', // INN, MFO, hisob raqami (bir necha qator)
    custom1: '',
    custom2: '',
    footer: 'Xaridingiz uchun rahmat!',
  },
  // Jadval ostidagi qismlar (jami doim chiqadi; chegirma va qarz faqat bo'lsa chiqadi)
  parts: {
    barcode: false, // jadvalda shtrix-kod ustuni
    unit: true, // soni yonida o'lchov birligi
    price: true, // narx ustuni
    discount: true, // chegirma / ustama (bo'lsa)
    payments: true, // to'lovlar kassalar bo'yicha
    debt: true, // qarz (bo'lsa)
    signatures: true, // "Topshirdi / Qabul qildi" imzolari
    footer: true, // pastki yozuv
  },
  blocks: BLOCKS,
};

const LOGO_MAX = 1_500_000; // ~1 MB rasm (base64)
const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : def;
};
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const str = (v, def, max = 500) => (typeof v === 'string' ? v.slice(0, max) : def);

function sanitize(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const blocks = {};
  for (const [key, d] of Object.entries(BLOCKS)) {
    const b = (src.blocks && src.blocks[key]) || {};
    blocks[key] = {
      show: bool(b.show, d.show),
      x: num(b.x, d.x, 0, 205),
      y: num(b.y, d.y, 0, 290),
      w: num(b.w, d.w, 5, 210),
      size: num(b.size, d.size, 6, 40),
      bold: bool(b.bold, d.bold),
      align: ['left', 'center', 'right'].includes(b.align) ? b.align : d.align,
    };
  }
  const texts = {};
  for (const [key, d] of Object.entries(DEFAULTS.texts)) texts[key] = str(src.texts && src.texts[key], d);
  const parts = {};
  for (const [key, d] of Object.entries(DEFAULTS.parts)) parts[key] = bool(src.parts && src.parts[key], d);

  const logo =
    typeof src.logo === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src.logo) && src.logo.length <= LOGO_MAX
      ? src.logo
      : '';

  return { tableTop: num(src.tableTop, DEFAULTS.tableTop, 10, 280), logo, texts, parts, blocks };
}

async function get() {
  const row = await Setting.findOne({ where: { key: KEY } });
  return sanitize(row ? row.value : DEFAULTS);
}

async function save(input) {
  if (input && typeof input.logo === 'string' && input.logo.length > LOGO_MAX) {
    throw Object.assign(new Error('Logo rasmi juda katta (1 MB gacha)'), { status: 400 });
  }
  const value = sanitize(input);
  const row = await Setting.findOne({ where: { key: KEY } });
  if (row) await row.update({ value });
  else await Setting.create({ key: KEY, value });
  return value;
}

module.exports = { get, save, sanitize, DEFAULTS };
