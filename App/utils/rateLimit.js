'use strict';

/**
 * Urinishlar cheklovchisi (parol tanlab ko'rish, ko'p zakaz va h.k.dan himoya), xotirada, sirpanuvchi oyna.
 *  - count(key): oynadagi urinishlar soni;
 *  - hit(key): urinishni yozadi. Xotira to'lgan va kalit yangi bo'lsa - false (YANGI kalit rad etiladi,
 *    lekin hali faol kalitlar hech qachon o'chirilmaydi: hujumchi keraksiz kalitlar bilan to'ldirib,
 *    qurbonning hisoblagichini "yuvib" yubora olmaydi);
 *  - refund(key): oxirgi urinishni qaytaradi (muvaffaqiyatli bo'lsa sanalmasin);
 *  - reset(key): hisoblagichni tozalaydi.
 */
class Limiter {
  constructor({ windowMs, max, maxKeys = 100000 }) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.hits = new Map(); // key -> [vaqt, ...]
    this.nextPrune = 0;
  }

  live(key, now = Date.now()) {
    const list = this.hits.get(key);
    if (!list) return [];
    const fresh = list.filter((t) => now - t < this.windowMs);
    if (fresh.length) this.hits.set(key, fresh);
    else this.hits.delete(key);
    return fresh;
  }

  count(key) {
    return this.live(key).length;
  }

  /** true - chegaradan oshmagan (va urinish yozildi) */
  allow(key) {
    if (this.count(key) >= this.max) return false;
    return this.hit(key);
  }

  hit(key) {
    const now = Date.now();
    const list = this.live(key, now);
    if (!list.length && this.hits.size >= this.maxKeys) {
      // Faqat eskirganlarni tozalaymiz (vaqti-vaqti bilan, har so'rovda emas)
      if (now >= this.nextPrune) {
        for (const k of [...this.hits.keys()]) this.live(k, now);
        this.nextPrune = now + 5000;
      }
      if (this.hits.size >= this.maxKeys) return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  refund(key) {
    const list = this.hits.get(key);
    if (!list || !list.length) return;
    list.pop();
    if (!list.length) this.hits.delete(key);
  }

  reset(key) {
    this.hits.delete(key);
  }
}

/** Login kaliti: kiritilgandek emas, qidiruvdagi kabi (bo'sh joysiz, kichik harf) */
const normLogin = (login) => String(login == null ? '' : login).trim().toLowerCase();

/** Mijoz IP manzili: IPv4 - o'zi, IPv6 - /64 tarmog'i (bitta foydalanuvchi minglab manzil olishi mumkin) */
function clientIp(req) {
  let ip = String(req.ip || (req.socket && req.socket.remoteAddress) || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes(':')) {
    const full = ip.includes('::')
      ? (() => {
          const [head, tail] = ip.split('::');
          const h = head ? head.split(':') : [];
          const t = tail ? tail.split(':') : [];
          return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
        })()
      : ip.split(':');
    return full.slice(0, 4).join(':') + '::/64';
  }
  return ip;
}

/**
 * Parol tekshiruvi oldidan uch bosqichli himoya (sinxron - parallel so'rovlar ham to'g'ri sanaladi):
 *  1) IP bo'yicha (arzon, birinchi) - ko'p loginni sinashdan;
 *  2) shu IP + login bo'yicha - bitta joydan bitta hisobga;
 *  3) login bo'yicha (IP almashtirilsa ham) - lekin FAQAT shu IP dan shu loginga xato bo'lgan bo'lsa bloklaydi:
 *     begona odam boshqa IP lardan xato urib, haqiqiy egani bloklab qo'ya olmaydi.
 * Muvaffaqiyatda: login hisoblagichlari tozalanadi, IP urinishi qaytariladi.
 */
function loginGuard({ ip, ipLimiter, loginIpLimiter, loginLimiter, loginKey }) {
  const pair = `${ip}|${loginKey}`;
  if (!ipLimiter.allow(ip)) return { allowed: false };
  const tried = loginIpLimiter.count(pair);
  if (tried >= loginIpLimiter.max || (tried > 0 && loginLimiter.count(loginKey) >= loginLimiter.max)) {
    ipLimiter.refund(ip);
    return { allowed: false };
  }
  // Urinish tekshiruvdan OLDIN yoziladi (parallel so'rovlar uchun); muvaffaqiyatda olib tashlanadi
  if (!loginIpLimiter.hit(pair) || !loginLimiter.hit(loginKey)) {
    ipLimiter.refund(ip);
    return { allowed: false };
  }
  return {
    allowed: true,
    success() {
      loginIpLimiter.reset(pair);
      loginLimiter.refund(loginKey);
      ipLimiter.refund(ip);
    },
  };
}

module.exports = { Limiter, normLogin, clientIp, loginGuard };
