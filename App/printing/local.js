'use strict';

/**
 * Kompyuterdagi dastur (Electron) uchun: bazasiz, faqat shu kompyuterning printerlari.
 * Printerlar ro'yxati (Windows) va ESC/POS baytlarini USB (Windows drayveri) yoki LAN (IP:9100) ga yuborish.
 */
const { execFile } = require('child_process');
const { sendNetwork } = require('./network');
const { sendWindows } = require('./windows');

/** Windows'da o'rnatilgan printerlar ro'yxati (XP-80 drayveri o'rnatilgan bo'lsa shu yerda chiqadi) */
function listPrinters() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Select-Object Name,PortName,DriverName | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          const parsed = JSON.parse(String(stdout).trim() || '[]');
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve(list.map((p) => ({ name: p.Name, port: p.PortName, driver: p.DriverName })));
        } catch {
          resolve([]);
        }
      },
    );
  });
}

/** printer: { type: 'usb' | 'network', printerName, host, port } */
const sendRaw = (printer, data) =>
  printer.type === 'network'
    ? sendNetwork({ host: printer.host, port: printer.port }, data)
    : sendWindows({ printerName: printer.printerName }, data);

// Navbat: cheklar bir-biriga aralashmay ketma-ket chiqadi
let queue = Promise.resolve();
function send(printer, data) {
  const next = queue.catch(() => {}).then(() => sendRaw(printer, data));
  queue = next;
  return next;
}

module.exports = { listPrinters, sendRaw, send };
