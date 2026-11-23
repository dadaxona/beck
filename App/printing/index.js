'use strict';

/**
 * Printerga yuborish: USB (Windows drayveri, RAW) yoki LAN (IP:9100).
 * Navbat: cheklar bir-biriga aralashmay ketma-ket chiqadi.
 * Kod andozasi: restaurant-printer loyihasi (Xprinter XP-80 / XP-58).
 */
const { sendRaw, listPrinters } = require('./local');
const { currentOrg } = require('../../database/tenant');

// Navbat har bir tashkilot uchun alohida: bir tashkilotning printeri osilib qolsa, boshqalariniki kutib qolmaydi
const queues = new Map();

/** printer: { type: 'usb' | 'network', printerName, host, port } */
function send(printer, data) {
  const key = currentOrg() || 0;
  const run = () => sendRaw(printer, data);
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(run);
  queues.set(key, next);
  next.catch(() => {}).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

module.exports = { send, listPrinters };
