'use strict';

/**
 * Rasmlar (tovar rasmi, A4 logotip) - sharp bilan, har biri 200 KB dan oshmaydi:
 *  - 200 KB va undan kichik rasm O'ZGARISHSIZ saqlanadi (faqat haqiqatan rasm ekanligi tekshiriladi);
 *  - kattasi 200 KB ga sig'guncha siqiladi: telefon burilishi (EXIF) to'g'rilanadi, eng katta tomoni 1600px gacha,
 *    sifat bosqichma-bosqich pasaytiriladi, kerak bo'lsa o'lcham kichraytiriladi.
 *    Shaffof (PNG) rasm WEBP bo'lib (shaffofligi saqlanadi), qolganlari JPEG (mozjpeg) bo'lib saqlanadi.
 *
 * Tovar rasmlari diskda: beck/uploads/products/<id>-<vaqt>.<kengaytma>, /uploads/products/... manzilidan beriladi.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const DIR = path.join(UPLOADS_DIR, 'products');
const URL_PREFIX = '/uploads/products/';
const LIMIT = 200 * 1024; // 200 KB
const MAX_INPUT = 15 * 1024 * 1024; // yuklanadigan fayl (siqishdan oldin)
const FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const fail = (status, message) => Object.assign(new Error(message), { status });

/** data:image/...;base64,... -> Buffer */
function decodeDataUrl(dataUrl) {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw fail(400, "Rasm formati noto'g'ri (JPG, PNG yoki WEBP)");
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) throw fail(400, "Rasm bo'sh");
  if (buf.length > MAX_INPUT) throw fail(400, 'Rasm hajmi 15 MB dan oshmasin');
  return buf;
}

/**
 * Rasmni 200 KB chegarasiga moslaydi. Qaytaradi: { buffer, ext } (ext: jpg | png | webp).
 * Rasm bo'lmasa yoki qo'llab-quvvatlanmagan format bo'lsa 400 xato.
 */
async function fitImage(input) {
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw fail(400, "Rasm formati noto'g'ri (JPG, PNG yoki WEBP)");
  }
  const ext = FORMATS[meta.format];
  if (!ext) throw fail(400, "Rasm formati noto'g'ri (JPG, PNG yoki WEBP)");

  // Kichik rasm - o'zgarishsiz
  if (input.length <= LIMIT) return { buffer: input, ext };

  const alpha = !!meta.hasAlpha;
  const longest = Math.max(meta.width || 0, meta.height || 0) || 1600;
  let side = Math.min(1600, longest);
  for (let round = 0; round < 10 && side >= 64; round++) {
    for (const quality of [82, 74, 66, 58, 50, 42]) {
      const pipeline = sharp(input)
        .rotate() // EXIF bo'yicha to'g'ri burish
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });
      const buffer = alpha
        ? await pipeline.webp({ quality, alphaQuality: 90 }).toBuffer()
        : await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (buffer.length <= LIMIT) return { buffer, ext: alpha ? 'webp' : 'jpg' };
    }
    side = Math.floor(side * 0.75);
  }
  throw fail(400, "Rasmni 200 KB gacha kichraytirib bo'lmadi");
}

/** Tovar rasmi: data URL -> fayl (<= 200 KB). Manzilni qaytaradi. */
async function save(productId, dataUrl) {
  const { buffer, ext } = await fitImage(decodeDataUrl(dataUrl));
  fs.mkdirSync(DIR, { recursive: true });
  const name = `${Number(productId)}-${Date.now()}.${ext}`;
  await fs.promises.writeFile(path.join(DIR, name), buffer);
  return URL_PREFIX + name;
}

/** Data URL dagi rasmni (masalan A4 logotip) 200 KB ga moslab yana data URL qilib qaytaradi */
async function fitDataUrl(dataUrl) {
  const { buffer, ext } = await fitImage(decodeDataUrl(dataUrl));
  return `data:${MIME[ext]};base64,${buffer.toString('base64')}`;
}

/** Eski rasm faylini o'chiradi (faqat bizning papkadagi fayl) */
function remove(url) {
  if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) return;
  const file = path.join(DIR, path.basename(url));
  fs.rm(file, { force: true }, () => {});
}

module.exports = { save, remove, fitImage, fitDataUrl, UPLOADS_DIR, LIMIT };
