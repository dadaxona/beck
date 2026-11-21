'use strict';

/**
 * Telegram botlari (mijozlar va xodimlar). Webhook emas, long polling (getUpdates) ishlatiladi:
 * dastur lokal kompyuterda turadi, Telegram'ga faqat chiquvchi so'rov kerak.
 *
 * Bot ulanganda mini app avtomatik ulanadi:
 *  - chat menyusidagi tugma (setChatMenuButton) mini app'ni ochadi: {publicUrl}/shop yoki {publicUrl}/agent
 *  - /start ga salom xabari va mini app'ni ochadigan tugma bilan javob beriladi
 *
 * Mini app'dan kelgan so'rovlar initData imzosi bot tokeni bilan tekshiriladi (verifyInitData).
 */
const crypto = require('crypto');
const settings = require('./telegramSettings');

const KINDS = ['client', 'employee'];
const PATHS = { client: '/shop', employee: '/agent' };

// Har bir bot holati: ishlayaptimi, username, oxirgi xato
const state = {
  client: { running: false, username: '', error: '', loop: null },
  employee: { running: false, username: '', error: '', loop: null },
};
let current = null; // oxirgi qo'llangan sozlamalar

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(token, method, params = {}, signal) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    const err = new Error((data && data.description) || `Telegram xatosi (${res.status})`);
    err.code = data ? data.error_code : res.status;
    throw err;
  }
  return data.result;
}

const appUrl = (s, kind) => `${s.publicUrl}${PATHS[kind]}`;

/** Bitta botning polling sikli. stop() chaqirilguncha ishlaydi. */
function startLoop(kind, s) {
  const bot = s[kind];
  const controller = new AbortController();
  const st = state[kind];
  let stopped = false;

  const run = async () => {
    try {
      const me = await call(bot.token, 'getMe', {}, controller.signal);
      st.username = me.username || '';
      // Polling ishlashi uchun webhook o'chiriladi (eski xabarlar tashlab yuborilmaydi)
      await call(bot.token, 'deleteWebhook', {}, controller.signal);
      // Mini app tugmasi (chat pastidagi menyu tugmasi)
      await call(bot.token, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: bot.buttonText, web_app: { url: appUrl(s, kind) } },
      }, controller.signal);
      await call(bot.token, 'setMyCommands', {
        commands: [{ command: 'start', description: bot.buttonText }],
      }, controller.signal);
      st.running = true;
      st.error = '';
    } catch (err) {
      if (stopped) return;
      st.running = false;
      st.error = err.message;
      console.error(`Telegram (${kind}) ulanmadi:`, err.message);
      // Token noto'g'ri bo'lsa qayta urinmaymiz; tarmoq xatosida keyinroq qayta urinamiz
      if (err.code === 401 || err.code === 404) return;
      await sleep(15000);
      if (!stopped) return run();
      return;
    }

    let offset = 0;
    while (!stopped) {
      try {
        const updates = await call(bot.token, 'getUpdates', { offset, timeout: 30, allowed_updates: ['message'] }, controller.signal);
        st.running = true;
        st.error = '';
        for (const u of updates) {
          offset = u.update_id + 1;
          handleUpdate(kind, s, u).catch((err) => console.error(`Telegram (${kind}) javob xatosi:`, err.message));
        }
      } catch (err) {
        if (stopped) break;
        st.error = err.message;
        if (err.code === 401) {
          st.running = false;
          break;
        }
        // 409: shu token bilan boshqa joyda ham bot ishlayapti
        await sleep(err.code === 409 ? 10000 : 5000);
      }
    }
  };

  run();
  return {
    stop() {
      stopped = true;
      controller.abort();
      st.running = false;
    },
  };
}

async function handleUpdate(kind, s, update) {
  const msg = update.message;
  if (!msg || !msg.chat || typeof msg.text !== 'string') return;
  const bot = s[kind];
  if (msg.text.startsWith('/start') || msg.text.trim().toLowerCase() === bot.buttonText.toLowerCase()) {
    await call(bot.token, 'sendMessage', {
      chat_id: msg.chat.id,
      text: bot.welcome,
      reply_markup: { inline_keyboard: [[{ text: bot.buttonText, web_app: { url: appUrl(s, kind) } }]] },
    });
  }
}

/** Sozlamalarni qo'llaydi: o'zgargan botlarni qayta ishga tushiradi, o'chirilganlarini to'xtatadi */
async function apply({ force = false } = {}) {
  const s = await settings.get();
  for (const kind of KINDS) {
    const bot = s[kind];
    const prev = current && current[kind];
    const same =
      prev && current.publicUrl === s.publicUrl && prev.token === bot.token && prev.enabled === bot.enabled &&
      prev.buttonText === bot.buttonText && prev.welcome === bot.welcome;
    if (!force && same && (state[kind].loop || !bot.enabled)) continue;

    if (state[kind].loop) {
      state[kind].loop.stop();
      state[kind].loop = null;
    }
    state[kind].error = '';
    state[kind].username = '';
    if (bot.enabled && bot.token && s.publicUrl) state[kind].loop = startLoop(kind, s);
  }
  current = s;
}

function status() {
  const out = {};
  for (const kind of KINDS) {
    const st = state[kind];
    out[kind] = { running: st.running, username: st.username, error: st.error, url: current && current.publicUrl ? appUrl(current, kind) : '' };
  }
  return out;
}

/**
 * Telegram WebApp initData tekshiruvi (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * To'g'ri bo'lsa { user, authDate } qaytaradi, aks holda null.
 */
function verifyInitData(initData, token, maxAgeSec = 7 * 24 * 3600) {
  if (!initData || !token || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (expected.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date')) || 0;
  if (maxAgeSec && Date.now() / 1000 - authDate > maxAgeSec) return null;
  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user || !user.id) return null;
  return { user, authDate };
}

/** Mijozga bot orqali xabar (zakaz qabul qilindi va h.k.). Xato bo'lsa jim o'tadi. */
async function notify(kind, chatId, text) {
  try {
    const s = current || (await settings.get());
    const bot = s[kind];
    if (!bot.enabled || !bot.token || !chatId) return;
    await call(bot.token, 'sendMessage', { chat_id: chatId, text });
  } catch (err) {
    console.error(`Telegram (${kind}) xabar yuborilmadi:`, err.message);
  }
}

/** Joriy sozlamalar (mini app so'rovlarini tekshirish uchun) */
const config = async () => current || (await settings.get());

module.exports = { apply, status, verifyInitData, notify, config };
