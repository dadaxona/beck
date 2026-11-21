'use strict';

/**
 * Telegram botlari va mini app'lar sozlamalari (Sozlamalar → Telegram). Bazada "telegram" kaliti ostida.
 *  publicUrl - dastur internetdan ochiladigan HTTPS manzil (Telegram mini app faqat HTTPS bilan ishlaydi),
 *              masalan Cloudflare Tunnel / ngrok yoki o'z domeningiz: https://shop.example.uz
 *  client    - mijozlar boti: internet magazin (/shop)
 *  employee  - xodimlar boti: agentlar uchun zakaz oynasi (/agent)
 */
const { Setting } = require('../../models');

const KEY = 'telegram';

const BOT_DEFAULTS = {
  enabled: false,
  token: '',
  buttonText: '',
  welcome: '',
};

const DEFAULTS = {
  publicUrl: '',
  shopName: '',
  client: { ...BOT_DEFAULTS, buttonText: "Do'kon", welcome: "Assalomu alaykum! Do'konimizga xush kelibsiz. Tovarlarni ko'rish va zakaz berish uchun pastdagi tugmani bosing." },
  employee: { ...BOT_DEFAULTS, buttonText: 'Zakaz berish', welcome: "Xodimlar uchun zakaz oynasi. Pastdagi tugmani bosing va login/parolingiz bilan kiring." },
};

const str = (v, d, max = 500) => (typeof v === 'string' ? v.slice(0, max) : d);
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

function sanitizeBot(input, current, defaults) {
  const b = input && typeof input === 'object' ? input : {};
  // token: berilmasa (undefined/null) eskisi qoladi; bo'sh satr - o'chiriladi
  let token = current.token;
  if (typeof b.token === 'string') token = b.token.trim();
  return {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : current.enabled,
    token,
    buttonText: str(b.buttonText, current.buttonText, 40).trim() || defaults.buttonText,
    welcome: str(b.welcome, current.welcome, 1000).trim() || defaults.welcome,
  };
}

function normalize(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    publicUrl: str(v.publicUrl, '', 300).trim().replace(/\/+$/, ''),
    shopName: str(v.shopName, '', 120).trim(),
    client: { ...DEFAULTS.client, ...(v.client || {}) },
    employee: { ...DEFAULTS.employee, ...(v.employee || {}) },
  };
}

function validate(s) {
  for (const kind of ['client', 'employee']) {
    const b = s[kind];
    if (b.token && !TOKEN_RE.test(b.token)) {
      throw Object.assign(new Error("Bot tokeni noto'g'ri. BotFather bergan tokenni to'liq kiriting"), { status: 400 });
    }
    if (b.enabled && !b.token) {
      throw Object.assign(new Error('Botni yoqish uchun tokenni kiriting'), { status: 400 });
    }
  }
  if (s.client.enabled && s.employee.enabled && s.client.token === s.employee.token) {
    throw Object.assign(new Error('Mijozlar va xodimlar uchun alohida bot kerak (tokenlar bir xil)'), { status: 400 });
  }
  if ((s.client.enabled || s.employee.enabled) && !/^https:\/\/[^\s/]+/i.test(s.publicUrl)) {
    throw Object.assign(new Error("Mini app uchun HTTPS manzil kiriting (masalan https://dokon.uz)"), { status: 400 });
  }
}

async function get() {
  const row = await Setting.findOne({ where: { key: KEY } });
  return normalize(row ? row.value : DEFAULTS);
}

async function save(input = {}) {
  const current = await get();
  const next = {
    publicUrl: str(input.publicUrl, current.publicUrl, 300).trim().replace(/\/+$/, ''),
    shopName: str(input.shopName, current.shopName, 120).trim(),
    client: sanitizeBot(input.client, current.client, DEFAULTS.client),
    employee: sanitizeBot(input.employee, current.employee, DEFAULTS.employee),
  };
  validate(next);
  const row = await Setting.findOne({ where: { key: KEY } });
  if (row) await row.update({ value: next });
  else await Setting.create({ key: KEY, value: next });
  return next;
}

/** Tokenni ekranga to'liq chiqarmaslik uchun: 123456:AA…xyz9 */
const maskToken = (token) => (token ? `${token.split(':')[0]}:${token.slice(-4).padStart(8, '•')}` : '');

/** Brauzerga yuboriladigan ko'rinish (tokenlar yashirilgan) */
function publicView(s) {
  const bot = (b) => ({ enabled: b.enabled, hasToken: !!b.token, tokenMask: maskToken(b.token), buttonText: b.buttonText, welcome: b.welcome });
  return { publicUrl: s.publicUrl, shopName: s.shopName, client: bot(s.client), employee: bot(s.employee) };
}

module.exports = { get, save, publicView, DEFAULTS };
