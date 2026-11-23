/*
 * AI yordamchi paneli (Gemini) - faqat kompyuter dasturida (Electron).
 *
 * XAVFSIZ USUL (o'zgartirmang):
 *  - gemini.google.com ko'rinib turadi, foydalanuvchi o'z akkaunti bilan o'zi kiradi.
 *  - Dastur faqat chat maydoniga prompt QO'YADI va CSV faylni BIRIKTIRADI.
 *  - "Yuborish"ni foydalanuvchi o'zi bosadi. Avtomatik yuborish, yashirin oyna, javobni o'qib olish,
 *    cookie olish, ichki API (StreamGenerate) - YO'Q (Google akkauntni bloklaydi).
 *
 * Gemini alohida WebContentsView da, alohida sessiyada (persist:gemini) - Dokon sahifasi uning cookie'larini
 * ko'rmaydi. Gemini sahifasiga preload / Node berilmaydi. Panel ramkasini Dokon sahifasi chizadi,
 * Gemini esa shu ramkaning ichki to'rtburchagiga joylashtiriladi (setBounds).
 */
const { ipcMain, shell, WebContentsView } = require('electron');

const GEMINI_URL = 'https://gemini.google.com/app';
const GEMINI_ORIGIN = 'https://gemini.google.com';
// Google login / Gemini sahifalari panel ichida, boshqa havolalar - oddiy brauzerda
const INSIDE = /^https:\/\/([a-z0-9-]+\.)*(google\.com|gstatic\.com|googleusercontent\.com)(\/|$)/i;
const MAX_PROMPT = 20000;
const MAX_CSV = 5 * 1024 * 1024;

let win = null; // Dokon oynasi
let view = null; // Gemini
let visible = false;

const EDITOR = `(document.querySelector('rich-textarea .ql-editor')
  || document.querySelector('div[contenteditable="true"][role="textbox"]')
  || document.querySelector('textarea'))`;

/** Chat maydonidagi foydalanuvchi yozgan matn */
const READ_EDITOR = `(() => { const el = ${EDITOR}; if (!el) return null;
  return ('value' in el ? el.value : el.innerText || '').trim(); })()`;

/** Maydonni fokuslab, ichini belgilaydi (keyin insertText eski matnni almashtiradi) */
const FOCUS_EDITOR = `(() => { const el = ${EDITOR}; if (!el) return false; el.focus();
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range); return true; })()`;

/** Faylni biriktirish: xuddi foydalanuvchi faylni chatga Ctrl+V qilgandek. Fayl diskka yozilmaydi */
const attachCode = (name, content) => `(() => { const el = ${EDITOR}; if (!el) return 'no-editor';
  const file = new File([${JSON.stringify('﻿' + content)}], ${JSON.stringify(name)}, { type: 'text/csv' });
  const dt = new DataTransfer(); dt.items.add(file); el.focus();
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return 'ok'; })()`;

// Gemini skriptlaridan ajratilgan dunyoda bajariladi (DOM umumiy, JS o'zgaruvchilari emas)
const run = (code) => view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code }]);

function ensureView() {
  if (view) return view;
  view = new WebContentsView({
    webPreferences: { partition: 'persist:gemini', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (INSIDE.test(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.loadURL(GEMINI_URL);
  return view;
}

/** Sahifa CSS pikselda yuboradi; Electron DIP da kutadi - sahifa masshtabi (Ctrl +/-) hisobga olinadi */
function toDip(b) {
  const z = win.webContents.getZoomFactor() || 1;
  const n = (v) => Math.max(0, Math.round(Number(v) * z) || 0);
  return { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
}

function show(bounds) {
  if (!win || win.isDestroyed()) return;
  ensureView();
  if (!visible) {
    win.contentView.addChildView(view);
    visible = true;
  }
  view.setBounds(toDip(bounds));
}

function hide() {
  if (!visible || !win || win.isDestroyed()) return;
  win.contentView.removeChildView(view); // sessiya va sahifa saqlanadi - keyingi ochilishda tez
  visible = false;
}

async function attach({ prompt, fileName, csv }) {
  if (!view) return { ok: false, reason: 'AI paneli ochilmagan' };
  if (!view.webContents.getURL().startsWith(GEMINI_ORIGIN + '/')) {
    return { ok: false, reason: "Gemini sahifasi ochiq emas. Gemini'ga kiring." };
  }
  const question = await run(READ_EDITOR).catch(() => null);
  if (question === null) return { ok: false, reason: "Gemini chat maydoni topilmadi: avval Google akkauntingiz bilan kiring." };
  if (csv) {
    const r = await run(attachCode(fileName, csv)).catch(() => 'error');
    if (r !== 'ok') return { ok: false, reason: "Faylni biriktirib bo'lmadi" };
  }
  // Maxsus prompt + foydalanuvchi chatga yozgan savol (bo'lsa)
  const text = question ? `${prompt}\n\nSavol: ${question}` : prompt;
  const focused = await run(FOCUS_EDITOR).catch(() => false);
  if (!focused) return { ok: false, reason: 'Gemini chat maydoni topilmadi' };
  view.webContents.focus();
  view.webContents.insertText(text); // klaviaturadan yozilgandek
  return { ok: true, hadQuestion: !!question };
}

/**
 * main.js dan bir marta chaqiriladi.
 * trusted(event) - so'rov Dokon saytidan (APP_URL) kelganini tekshiradi.
 */
function setupAiPanel({ trusted }) {
  const fromApp = (event) => win && !win.isDestroyed() && event.sender === win.webContents && trusted(event);
  const validBounds = (b) => b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(Number(b[k])));

  ipcMain.handle('ai:show', (event, bounds) => {
    if (!fromApp(event) || !validBounds(bounds)) return false;
    show(bounds);
    return true;
  });
  ipcMain.handle('ai:hide', (event) => {
    if (fromApp(event)) hide();
  });
  ipcMain.handle('ai:home', (event) => {
    if (fromApp(event) && view) view.webContents.loadURL(GEMINI_URL);
  });
  ipcMain.handle('ai:attach', async (event, data) => {
    if (!fromApp(event)) return { ok: false, reason: "Ruxsat yo'q" };
    const { prompt, fileName, csv } = data || {};
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, reason: "Prompt bo'sh" };
    if (csv != null && (typeof csv !== 'string' || csv.length > MAX_CSV)) return { ok: false, reason: "Ma'lumot juda katta (5 MB dan ortiq)" };
    const safeName = String(fileName || 'dokon.csv').replace(/[^\w.\-]/g, '_').slice(0, 80);
    return attach({ prompt: prompt.slice(0, MAX_PROMPT), fileName: safeName, csv: csv || '' });
  });
}

/** Dokon oynasi yaratilganda: panel shu oynaga bog'lanadi. Sahifa almashsa / qayta yuklansa panel yopiladi */
function attachWindow(mainWindow) {
  win = mainWindow;
  visible = false;
  // Electron versiyalariga mos: yangi - details obyekti, eski - (event, url, isInPlace, isMainFrame)
  win.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    const main = e?.isMainFrame ?? isMainFrame;
    const same = e?.isSameDocument ?? isInPlace;
    if (main && !same) hide();
  });
}

module.exports = { setupAiPanel, attachWindow };
