/*
 * AI yordamchi paneli (Gemini, ChatGPT, Claude, DeepSeek, Kimi) - faqat kompyuter dasturida (Electron).
 *
 * XAVFSIZ USUL (o'zgartirmang):
 *  - AI sayti ko'rinib turadi, foydalanuvchi o'z akkaunti bilan o'zi kiradi.
 *  - Dastur faqat chat maydoniga prompt QO'YADI va CSV faylni BIRIKTIRADI (xuddi Ctrl+V qilgandek).
 *  - "Yuborish"ni foydalanuvchi o'zi bosadi. Avtomatik yuborish, yashirin oyna, javobni o'qib olish,
 *    cookie olish, ichki API - YO'Q (AI xizmatlari akkauntni bloklaydi).
 *
 * Har bir AI alohida WebContentsView da, alohida sessiyada (persist:ai-<id>) - Dokon sahifasi ularning
 * cookie'larini ko'rmaydi, ular bir-birinikini ham. AI sahifalariga preload / Node berilmaydi.
 * Panel ramkasini Dokon sahifasi chizadi, AI sayti shu ramkaning ichki to'rtburchagiga joylashtiriladi.
 */
const { ipcMain, shell, WebContentsView } = require('electron');

// Kirish (login) sahifalari: Google / Microsoft / Apple orqali kirish panel ichida ishlashi uchun
const AUTH = String.raw`accounts\.google\.com|([a-z0-9-]+\.)*google\.com|gstatic\.com|googleusercontent\.com|login\.live\.com|login\.microsoftonline\.com|appleid\.apple\.com`;
const inside = (domains) => new RegExp(String.raw`^https:\/\/(([a-z0-9-]+\.)*(${domains})|${AUTH})(\/|:|$)`, 'i');
// Login oynasi (popup bo'lib ochiladi): Google/Microsoft/Apple yoki saytning o'z OAuth/login manzili
const LOGIN_POPUP = /^https:\/\/(accounts\.google\.com|login\.live\.com|login\.microsoftonline\.com|appleid\.apple\.com)(\/|$)|\/(oauth2?|auth|login|signin|sign-in|sso)(\/|\?|$)/i;

/**
 * Har bir AI: bosh sahifasi, panel ichida ochiladigan domenlar va chat maydonini topish uchun selektorlar.
 * Sayt tuzilishi o'zgarsa - faqat shu yerdagi selektorni tuzatish kifoya.
 */
const PROVIDERS = {
  gemini: {
    url: 'https://gemini.google.com/app',
    inside: inside(String.raw`gemini\.google\.com`),
    editor: ['rich-textarea .ql-editor', 'div[contenteditable="true"][role="textbox"]'],
  },
  chatgpt: {
    url: 'https://chatgpt.com/',
    inside: inside(String.raw`chatgpt\.com|openai\.com|oaistatic\.com|oaiusercontent\.com|auth0\.com`),
    editor: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea'],
  },
  claude: {
    url: 'https://claude.ai/new',
    inside: inside(String.raw`claude\.ai|anthropic\.com|claudeusercontent\.com`),
    editor: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
    // Claude dasturiy Ctrl+V dagi faylni qabul qilmaydi - o'zining "fayl yuklash" maydoni orqali beriladi
    attach: 'input',
    fileInput: ['input[data-testid="file-upload"]', 'input[type="file"]'],
  },
  deepseek: {
    url: 'https://chat.deepseek.com/',
    inside: inside(String.raw`deepseek\.com`),
    editor: ['textarea#chat-input', 'textarea', 'div[contenteditable="true"]'],
  },
  kimi: {
    // kimi.ai - xalqaro versiya (Google bilan kirish). kimi.com - Xitoy telefon raqami / WeChat bilan
    url: 'https://www.kimi.ai/',
    inside: inside(String.raw`kimi\.com|kimi\.ai|moonshot\.cn|moonshot\.ai`),
    editor: ['.chat-input-editor[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
  },
};

const MAX_PROMPT = 20000;
const MAX_CSV = 20 * 1024 * 1024; // barcha fayllar jami
const MAX_FILES = 10; // AI xizmatlari bitta xabarga odatda ~10 tagacha fayl qabul qiladi

let win = null; // Dokon oynasi
const views = new Map(); // id -> WebContentsView (bir marta yaratiladi, sessiya saqlanadi)
let shown = null; // hozir ko'rinib turgan AI id

const editorExpr = (p) => `(${p.editor.map((s) => `document.querySelector(${JSON.stringify(s)})`).join(' || ')})`;

/** Chat maydonidagi foydalanuvchi yozgan matn */
const readEditor = (p) => `(() => { const el = ${editorExpr(p)}; if (!el) return null;
  return ('value' in el ? el.value : el.innerText || '').trim(); })()`;

/** Maydonni fokuslab, ichini belgilaydi (keyin insertText eski matnni almashtiradi) */
const focusEditor = (p) => `(() => { const el = ${editorExpr(p)}; if (!el) return false; el.focus();
  if ('value' in el) { el.select(); return true; }
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range); return true; })()`;

/**
 * Faylni biriktirish. Fayl diskka yozilmaydi.
 *  - 'paste' (standart): xuddi foydalanuvchi faylni chatga Ctrl+V qilgandek;
 *  - 'input': saytning o'z "fayl yuklash" maydoni orqali (xuddi 📎 bosib fayl tanlagandek).
 *    Maydon topilmasa - 'paste' ga o'tiladi.
 */
const attachFile = (p, files) => `(() => { const el = ${editorExpr(p)}; if (!el) return 'no-editor';
  const dt = new DataTransfer();
  for (const f of ${JSON.stringify(files)}) dt.items.add(new File(['\\uFEFF' + f.csv], f.name, { type: 'text/csv' }));
  if (${JSON.stringify(p.attach || 'paste')} === 'input') {
    const inp = ${(p.fileInput || ['input[type="file"]']).map((s) => `document.querySelector(${JSON.stringify(s)})`).join(' || ')};
    if (inp) {
      inp.files = dt.files;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    }
  }
  el.focus();
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return 'ok'; })()`;

function ensureView(id) {
  if (views.has(id)) return views.get(id);
  const p = PROVIDERS[id];
  const view = new WebContentsView({
    webPreferences: { partition: `persist:ai-${id}`, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = view.webContents;
  // Yangi oyna so'ralganda:
  //  - login (Google bilan kirish va h.k.) - kichik popup oyna; u yopilganda panel yangilanadi (kirgan holat ko'rinsin);
  //  - saytning o'z sahifasi (masalan "kimi.ai ga o'ting") - panelning o'zida ochiladi;
  //  - boshqa havolalar - oddiy brauzerda.
  wc.on('did-create-window', (child) => {
    child.once('closed', () => {
      if (!wc.isDestroyed()) wc.reload();
    });
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (p.inside.test(url) && !LOGIN_POPUP.test(url)) {
      wc.loadURL(url);
      return { action: 'deny' };
    }
    if (p.inside.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: { partition: `persist:ai-${id}`, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (p.inside.test(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.loadURL(p.url);
  views.set(id, view);
  return view;
}

/** Sahifa CSS pikselda yuboradi; Electron DIP da kutadi - sahifa masshtabi (Ctrl +/-) hisobga olinadi */
function toDip(b) {
  const z = win.webContents.getZoomFactor() || 1;
  const n = (v) => Math.max(0, Math.round(Number(v) * z) || 0);
  return { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
}

function show(id, bounds) {
  if (!win || win.isDestroyed()) return;
  if (shown && shown !== id) hide();
  const view = ensureView(id);
  if (shown !== id) {
    win.contentView.addChildView(view);
    shown = id;
  }
  view.setBounds(toDip(bounds));
}

function hide() {
  if (!shown || !win || win.isDestroyed()) return;
  const view = views.get(shown);
  if (view) win.contentView.removeChildView(view); // sahifa va login saqlanadi - keyingi safar tez ochiladi
  shown = null;
}

async function attach(id, { prompt, files }) {
  const view = views.get(id);
  const p = PROVIDERS[id];
  if (!view) return { ok: false, reason: 'AI paneli ochilmagan' };
  const run = (code) => view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code }]); // AI skriptlaridan ajratilgan dunyo
  const question = await run(readEditor(p)).catch(() => null);
  if (question === null) return { ok: false, reason: 'Chat maydoni topilmadi: avval akkauntingiz bilan kiring (yoki sahifa yuklanishini kuting).' };
  if (files.length) {
    const r = await run(attachFile(p, files)).catch(() => 'error');
    if (r !== 'ok') return { ok: false, reason: "Faylni biriktirib bo'lmadi" };
  }
  // Maxsus prompt + foydalanuvchi chatga yozgan savol (bo'lsa)
  const text = question ? `${prompt}\n\nMening savolim: ${question}` : prompt;
  // Fayl biriktirilgach ba'zi saytlar maydonni qayta chizadi - biroz kutamiz
  await new Promise((r) => setTimeout(r, 250));
  const focused = await run(focusEditor(p)).catch(() => false);
  if (!focused) return { ok: false, reason: 'Chat maydoni topilmadi' };
  view.webContents.focus();
  view.webContents.insertText(text); // klaviaturadan yozilgandek
  return { ok: true, hadQuestion: !!question };
}

/** main.js dan bir marta chaqiriladi. trusted(event) - so'rov Dokon saytidan kelganini tekshiradi */
function setupAiPanel({ trusted }) {
  const fromApp = (event) => win && !win.isDestroyed() && event.sender === win.webContents && trusted(event);
  const validBounds = (b) => b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(Number(b[k])));
  const known = (id) => Object.prototype.hasOwnProperty.call(PROVIDERS, id);

  ipcMain.handle('ai:show', (event, id, bounds) => {
    if (!fromApp(event) || !known(id) || !validBounds(bounds)) return false;
    show(id, bounds);
    return true;
  });
  ipcMain.handle('ai:hide', (event) => {
    if (fromApp(event)) hide();
  });
  ipcMain.handle('ai:home', (event, id) => {
    if (fromApp(event) && known(id) && views.has(id)) views.get(id).webContents.loadURL(PROVIDERS[id].url);
  });
  ipcMain.handle('ai:attach', async (event, id, data) => {
    if (!fromApp(event)) return { ok: false, reason: "Ruxsat yo'q" };
    if (!known(id)) return { ok: false, reason: "Noma'lum AI" };
    // Bitta fayl ({ fileName, csv }) yoki bir nechta fayl ({ files: [{ name, csv }] })
    const { prompt, fileName, csv } = data || {};
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, reason: "Prompt bo'sh" };
    const list = Array.isArray(data?.files) ? data.files : csv ? [{ name: fileName, csv }] : [];
    if (list.length > MAX_FILES) return { ok: false, reason: `Fayllar juda ko'p (${MAX_FILES} tadan ortiq)` };
    if (list.some((f) => !f || typeof f.csv !== 'string')) return { ok: false, reason: "Ma'lumot noto'g'ri" };
    if (list.reduce((t, f) => t + f.csv.length, 0) > MAX_CSV) return { ok: false, reason: "Ma'lumot juda katta (20 MB dan ortiq)" };
    const files = list.map((f) => ({ name: String(f.name || 'dokon.csv').replace(/[^\w.\-]/g, '_').slice(0, 80), csv: f.csv }));
    return attach(id, { prompt: prompt.slice(0, MAX_PROMPT), files });
  });
}

/** Dokon oynasi yaratilganda: panel shu oynaga bog'lanadi. Sahifa qayta yuklansa panel yopiladi */
function attachWindow(mainWindow) {
  win = mainWindow;
  shown = null;
  // Electron versiyalariga mos: yangi - details obyekti, eski - (event, url, isInPlace, isMainFrame)
  win.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    const main = e?.isMainFrame ?? isMainFrame;
    const same = e?.isSameDocument ?? isInPlace;
    if (main && !same) hide();
  });
  win.on('closed', () => {
    for (const v of views.values()) v.webContents.close();
    views.clear();
    shown = null;
  });
}

module.exports = { setupAiPanel, attachWindow };
