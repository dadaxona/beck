'use strict';

/**
 * JWT sozlamalari.
 * Kalit: JWT_SECRET muhit o'zgaruvchisi; berilmasa har bir o'rnatish uchun TASODIFIY kalit bir marta yaratilib
 * faylda saqlanadi (database/.jwt-secret). Kodga yozilgan umumiy kalit yo'q: kod ochiq bo'lsa ham boshqalar
 * token yasay olmaydi.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  const file = process.env.JWT_SECRET_FILE || path.join(__dirname, '..', 'database', '.jwt-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // hali yo'q - yaratamiz
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

module.exports = {
  JWT_SECRET: loadSecret(),
  // Token muddati. Har kuni avtomatik yangilanadi (auth middleware X-New-Token), shuning uchun foydalanuvchi
  // dasturdan foydalanib tursa doim tizimda qoladi; 30 kun umuman kirilmasa qayta login so'raladi.
  JWT_EXPIRES_IN: '30d',
  /** Shundan eski token har so'rovda yangisiga almashtiriladi (soniya) */
  REFRESH_AFTER: 24 * 3600,
};
