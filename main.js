const { app, BrowserWindow } = require('electron');
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

// JWT kaliti har bir kompyuterning o'zida (dastur papkasida emas): o'rnatuvchiga tushib, hamma joyda bir xil bo'lib qolmasin
process.env.JWT_SECRET_FILE = process.env.JWT_SECRET_FILE || path.join(app.getPath('userData'), '.jwt-secret');
const server = require('./index.js');
// USB printer (XP-80) uchun yordamchi DLL dastur papkasida bir marta yaratiladi
require('./App/printing/windows').setHelperDir(app.getPath('userData'));
const APP_URL = `http://localhost:${Number(process.env.PORT) || 5678}`; // server porti bilan bir xil

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
        webPreferences: {
            webviewTag: true,
            webSecurity: false,
            nodeIntegration: true,
            contextIsolation: false,
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
