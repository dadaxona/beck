const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

/*
 * Oddiy dastur kabi ishlaydi: ish stolidagi yorliq bosilsa ochiladi, oyna yopilsa to'liq to'xtaydi.
 * Orqa fonda (trey / yashirin belgilarda) qolmaydi va kompyuter yonganda o'zi ishga tushmaydi.
 */

// Dastur faqat bitta nusxada ishlaydi (ikkinchisi port 4567 ni ololmay xato berardi): qayta ochilsa bor oyna ko'rsatiladi
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

// Windows: panel (taskbar), "Пуск" va bildirishnomalarda dastur o'z ikonkasi bilan chiqsin.
// ID package.json dagi build.appId bilan bir xil bo'lishi shart (o'rnatuvchi yorliqlari shu ID bilan yaratiladi).
if (process.platform === 'win32') app.setAppUserModelId('com.2C');
const ICON = path.join(__dirname, 'icon.ico');

/*
 * Qaysi saytni ochadi: standart - internetdagi server. Lokal (bazasi shu kompyuterda) ishlatish uchun:
 * APP_URL=local (yoki http://localhost:5678) bilan ishga tushiriladi - shunda ichki server ham yoqiladi.
 */
const LOCAL_URL = "https://savdo-24.uz";
const APP_URL = process.env.APP_URL === 'local' ? LOCAL_URL : (process.env.APP_URL || 'https://savdo-24.uz').replace(/\/+$/, '');
const IS_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL);
const APP_ORIGIN = new URL(APP_URL).origin;

let server = { ready: Promise.resolve() };
if (IS_LOCAL) {
    // JWT kaliti har bir kompyuterning o'zida (dastur papkasida emas): o'rnatuvchiga tushib, hamma joyda bir xil bo'lib qolmasin
    process.env.JWT_SECRET_FILE = process.env.JWT_SECRET_FILE || path.join(app.getPath('userData'), '.jwt-secret');
    server = require('./index.js');
}
// USB printer (XP-80) uchun yordamchi DLL dastur papkasida bir marta yaratiladi
require('./App/printing/windows').setHelperDir(app.getPath('userData'));
const localPrinter = require('./App/printing/local');

/** Printer ko'prigi faqat o'z saytimizdan (APP_URL) chaqirilsa ishlaydi */
const trusted = (event) => {
    try {
        return new URL(event.senderFrame.url).origin === APP_ORIGIN;
    } catch {
        return false;
    }
};
function cleanPrinter(p) {
    if (!p || typeof p !== 'object') throw new Error("Printer sozlanmagan");
    if (p.type === 'network') {
        const host = String(p.host || '').trim();
        const port = Number(p.port) || 9100;
        if (!/^[a-zA-Z0-9.\-]{1,253}$/.test(host)) throw new Error("Printer IP manzili noto'g'ri");
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Printer porti noto'g'ri");
        return { type: 'network', host, port };
    }
    const printerName = String(p.printerName || '').trim();
    if (!printerName || printerName.length > 260) throw new Error("Printer tanlanmagan");
    return { type: 'usb', printerName };
}
ipcMain.handle('printer:list', (event) => (trusted(event) ? localPrinter.listPrinters() : []));
ipcMain.handle('printer:send', async (event, printer, data) => {
    if (!trusted(event)) throw new Error("Ruxsat yo'q");
    if (typeof data !== 'string' || data.length > 4 * 1024 * 1024) throw new Error("Chek ma'lumoti noto'g'ri");
    await localPrinter.send(cleanPrinter(printer), Buffer.from(data, 'base64'));
    return { printed: true };
});

/** Server tayyor bo'lguncha ko'rinadigan oddiy sahifa (oq ekran o'rniga) */
const statusPage = (text, isError = false) =>
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>2C</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#eef0f4;font:14px Segoe UI,Arial,sans-serif;color:${isError ? '#b91c1c' : '#3f3f46'}">
<div style="text-align:center;max-width:640px;padding:24px"><div style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;padding:6px 10px;margin-bottom:14px">2C</div>
<div style="white-space:pre-wrap">${text.replace(/</g, '&lt;')}</div></div></body></html>`);

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: true,
        icon: ICON,
        // Internetdagi sayt ochiladi: Node.js ruxsatlari berilmaydi, faqat preload.js dagi printer ko'prigi
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        }
    });

    // Avval "Yuklanmoqda", server (baza tekshiruvi) tayyor bo'lgach asosiy sahifa.
    // Ilgari oyna serverdan oldin ochilib, ulanolmay oq ekranda qolib ketardi.
    mainWindow.loadURL(statusPage('Yuklanmoqda...'));
    server.ready
        .then(() => mainWindow && mainWindow.loadURL(APP_URL))
        .catch((err) => {
            if (mainWindow) mainWindow.loadURL(statusPage(`Dasturni ishga tushirib bo'lmadi:\n${err && err.message ? err.message : err}`, true));
        });

    // Boshqa saytlar (Telegram havolasi va b.) dastur ichida emas, oddiy brauzerda ochiladi
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url) && !url.startsWith(APP_ORIGIN)) shell.openExternal(url);
        return { action: url.startsWith(APP_ORIGIN) ? 'allow' : 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(APP_ORIGIN) || url.startsWith('data:')) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    });

    // Sahifa yuklanmasa (server vaqtincha javob bermasa) - bir soniyadan keyin qayta urinadi
    mainWindow.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
        if (!isMainFrame || !String(url).startsWith(APP_URL)) return;
        setTimeout(() => mainWindow && !mainWindow.isDestroyed() && mainWindow.loadURL(APP_URL), 1000);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Avvalgi versiyalar avtomatik ishga tushishni yoqib qo'ygan bo'lsa - o'chiramiz
    try {
        app.setLoginItemSettings({ openAtLogin: false });
    } catch {
        // e'tiborsiz
    }
    createWindow();
});

// Oyna yopilsa dastur (va ichidagi server) to'liq to'xtaydi - orqa fonda qolmaydi
app.on('window-all-closed', () => {
    app.quit();
});

// Dastur yana ochilmoqchi bo'lsa (masalan yorliqdan) - bor oyna oldinga chiqadi
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    } else {
        createWindow();
    }
});
