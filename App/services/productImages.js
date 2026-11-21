'use strict';

/**
 * Tovar rasmlari diskda saqlanadi: beck/uploads/products/<id>-<vaqt>.<kengaytma>
 * va /uploads/products/... manzilidan beriladi (index.js). Bazada faqat manzil (Product.image).
 */
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const DIR = path.join(UPLOADS_DIR, 'products');
const URL_PREFIX = '/uploads/products/';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const fail = (status, message) => Object.assign(new Error(message), { status });

/** data URL ni faylga yozadi va uning manzilini qaytaradi */
function save(productId, dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m || !TYPES[m[1]]) throw fail(400, 'Rasm formati noto\'g\'ri (JPG, PNG yoki WEBP)');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw fail(400, 'Rasm bo\'sh');
  if (buf.length > MAX_BYTES) throw fail(400, 'Rasm hajmi 5 MB dan oshmasin');
  fs.mkdirSync(DIR, { recursive: true });
  const name = `${Number(productId)}-${Date.now()}.${TYPES[m[1]]}`;
  fs.writeFileSync(path.join(DIR, name), buf);
  return URL_PREFIX + name;
}

/** Eski rasm faylini o'chiradi (faqat bizning papkadagi fayl) */
function remove(url) {
  if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) return;
  const file = path.join(DIR, path.basename(url));
  fs.rm(file, { force: true }, () => {});
}

module.exports = { save, remove, UPLOADS_DIR };
