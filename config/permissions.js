'use strict';

/**
 * Ruxsatlar katalogi: bo'lim (tizimning yuqoridagi tabi) -> shu bo'limda mumkin bo'lgan amallar.
 *  view   - bo'limga kirish va ma'lumotni ko'rish
 *  create - yangisini yaratish
 *  edit   - o'zgartirish
 *  delete - o'chirish
 * Rolsiz foydalanuvchi (birinchi ro'yxatdan o'tgan) administrator: hamma narsaga ruxsat.
 */
const ACTIONS = ['view', 'create', 'edit', 'delete', 'purge'];

// delete = o'chirishga belgilash (1C dagi X: ro'yxatda qoladi, hisob-kitobda qatnashmaydi, tiklash mumkin)
// purge  = butunlay o'chirish (faqat ruxsat berilganlar, odatda administrator)
const SECTIONS = {
  dashboard: ['view'],
  sales: ['view', 'create'],
  'sales-journal': ['view', 'delete', 'purge'],
  basket: ['view', 'edit', 'delete', 'purge'], // edit = qarz muddatini o'zgartirish
  returns: ['view', 'create', 'edit', 'delete', 'purge'],
  contractors: ['view', 'create', 'edit', 'delete', 'purge'],
  products: ['view', 'create', 'edit', 'delete', 'purge'],
  receipts: ['view', 'create', 'edit', 'delete', 'purge'],
  cash: ['view', 'create', 'edit', 'delete', 'purge'],
  payroll: ['view', 'create', 'edit', 'delete', 'purge'],
  investments: ['view', 'create', 'delete', 'purge'], // investitsiya: tashqaridan kiritilgan pul (kassaga)
  writeoffs: ['view', 'create', 'edit', 'delete', 'purge'], // edit = qaytarish
  transfers: ['view', 'create', 'delete', 'purge'], // ombordan omborga ko'chirish
  reconciliation: ['view'],
  debtors: ['view'],
  finance: ['view'],
  // Zakazlar (Telegram mini app'lar): view = ro'yxat va bildirishnoma, create = xodimlar mini app'idan zakaz berish,
  // edit = bekor qilish. Zakazdan sotuv qilish uchun "Sotuv → create" ruxsati kerak.
  orders: ['view', 'create', 'edit'],
  settings: ['view', 'create', 'edit', 'delete'],
};

/** Hamma ruxsat (administrator) */
const full = () => Object.fromEntries(Object.entries(SECTIONS).map(([s, a]) => [s, [...a]]));

/**
 * Kelgan ma'lumotni katalogga moslaydi: noma'lum bo'lim/amallar tashlanadi,
 * boshqa amal belgilangan bo'lsa "view" ham qo'shiladi (ko'rmasdan o'zgartirib bo'lmaydi).
 */
function sanitize(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [section, allowed] of Object.entries(SECTIONS)) {
    const given = Array.isArray(input[section]) ? input[section] : [];
    const actions = ACTIONS.filter((a) => allowed.includes(a) && given.includes(a));
    if (actions.length && !actions.includes('view')) actions.unshift('view');
    if (actions.length) out[section] = actions;
  }
  return out;
}

/**
 * Xodimlar mini app'i uchun ruxsatlar: sotuv (va sotuvga o'xshash pul/ombor hujjatlarini yaratish) hech qachon
 * mumkin emas, faqat ko'rish va zakaz berish. Obyektni joyida o'zgartiradi.
 */
const MINIAPP_READONLY = ['sales', 'sales-journal', 'basket', 'returns', 'receipts', 'cash', 'payroll', 'investments', 'writeoffs', 'transfers', 'settings'];
function forMiniApp(perms) {
  for (const section of MINIAPP_READONLY) {
    if (!perms[section]) continue;
    if (section === 'sales' || section === 'settings') delete perms[section];
    else perms[section] = perms[section].filter((a) => a === 'view');
  }
  // Zakazlar: mini app'da faqat zakaz berish va o'z zakazlarini ko'rish (boshqalarning mijoz ma'lumotlari ko'rinmaydi)
  if (perms.orders) {
    if (perms.orders.includes('create')) perms.orders = ['create'];
    else delete perms.orders;
  }
  return perms;
}

const has = (permissions, section, action = 'view') =>
  !!permissions && Array.isArray(permissions[section]) && permissions[section].includes(action);

module.exports = { ACTIONS, SECTIONS, full, sanitize, has, forMiniApp };
