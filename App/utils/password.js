'use strict';

/**
 * Parollar shifrlangan holda saqlanadi (Node.js crypto.scrypt, qo'shimcha kutubxonasiz):
 *   scrypt$<salt hex>$<hash hex>
 * Eski (ochiq saqlangan) parollar ham tekshiriladi va birinchi muvaffaqiyatli kirishda shifrlanadi (needsRehash).
 */
const crypto = require('crypto');

const PREFIX = 'scrypt$';
const KEYLEN = 64;

const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key))),
  );

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt);
  return `${PREFIX}${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.startsWith(PREFIX)) {
    // Eski yozuv: ochiq parol (vaqt bo'yicha sizdirmaslik uchun timingSafeEqual)
    const a = Buffer.from(String(password));
    const b = Buffer.from(stored);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, salt, hex] = stored.split('$');
  if (!salt || !hex) return false;
  const key = await scrypt(password, salt);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

const needsRehash = (stored) => typeof stored === 'string' && !stored.startsWith(PREFIX);

module.exports = { hashPassword, verifyPassword, needsRehash };
