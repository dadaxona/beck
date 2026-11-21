'use strict';

/**
 * Printerga yuborish: USB (Windows drayveri, RAW) yoki LAN (IP:9100).
 * Navbat: cheklar bir-biriga aralashmay ketma-ket chiqadi.
 * Kod andozasi: restaurant-printer loyihasi (Xprinter XP-80 / XP-58).
 */
const { execFile } = require('child_process');
const { sendNetwork } = require('./network');
const { sendWindows } = require('./windows');

let queue = Promise.resolve();

/** printer: { type: 'usb' | 'network', printerName, host, port } */
function send(printer, data) {
  const run = () =>
    printer.type === 'network'
      ? sendNetwork({ host: printer.host, port: printer.port }, data)
      : sendWindows({ printerName: printer.printerName }, data);
  const next = queue.catch(() => {}).then(run);
  queue = next;
  return next;
}

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

module.exports = { send, listPrinters };
