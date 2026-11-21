'use strict';

/**
 * Chek va printer sozlamalari (Sozlamalar → Chek va printer). Bazada "receipt" kaliti ostida saqlanadi.
 * Kelgan ma'lumot faqat ma'lum maydonlar bilan, turini tekshirib qabul qilinadi.
 */
const { Setting } = require('../../models');
const { CODEPAGES } = require('../printing/encoder');

const KEY = 'receipt';

const DEFAULTS = {
  printer: {
    type: 'usb', // usb (Windows drayveri) | network (LAN, IP:9100)
    printerName: '', // Windows'dagi printer nomi, masalan "XP-80"
    host: '',
    port: 9100,
    width: 80, // qog'oz kengligi: 80 yoki 58 mm
    codepage: 'cp866', // kirill uchun
    codepageTable: null, // kirill buzilsa qo'lda: 17 / 46 / 59
    cut: true, // qog'ozni kesish
    drawer: false, // pul qutisini ochish (naqd to'lovda)
    copies: 1,
    autoPrint: false, // sotuv qabul qilinganda chek avtomatik chiqsin
  },
  layout: {
    language: 'uz', // chekdagi yozuvlar tili: uz | ru
    shopName: '', // Tashkilot nomi: chek tepasida va barcha hujjatlarda (akt sverka...)
    header: '', // manzil, telefon, INN (bir necha qator)
    footer: 'Xaridingiz uchun rahmat!',
    showCashier: true,
    showClient: true,
    showBarcode: false,
    showPayments: true,
    showDebt: true,
    bigTotal: true, // JAMI katta shriftda
  },
};

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const str = (v, d, max = 500) => (typeof v === 'string' ? v.slice(0, max) : d);

function sanitize(input = {}) {
  const p = input.printer || {};
  const l = input.layout || {};
  const D = DEFAULTS;
  const table = Number(p.codepageTable);
  return {
    printer: {
      type: p.type === 'network' ? 'network' : 'usb',
      printerName: str(p.printerName, D.printer.printerName, 200).trim(),
      host: str(p.host, D.printer.host, 100).trim(),
      port: Number(p.port) > 0 && Number(p.port) < 65536 ? Math.floor(Number(p.port)) : D.printer.port,
      width: Number(p.width) === 58 ? 58 : 80,
      codepage: CODEPAGES[p.codepage] ? p.codepage : D.printer.codepage,
      codepageTable: Number.isInteger(table) && table >= 0 && table <= 255 && p.codepageTable !== '' && p.codepageTable !== null ? table : null,
      cut: bool(p.cut, D.printer.cut),
      drawer: bool(p.drawer, D.printer.drawer),
      copies: Math.min(3, Math.max(1, Math.floor(Number(p.copies) || 1))),
      autoPrint: bool(p.autoPrint, D.printer.autoPrint),
    },
    layout: {
      language: l.language === 'ru' ? 'ru' : 'uz',
      shopName: str(l.shopName, D.layout.shopName, 120),
      header: str(l.header, D.layout.header),
      footer: str(l.footer, D.layout.footer),
      showCashier: bool(l.showCashier, D.layout.showCashier),
      showClient: bool(l.showClient, D.layout.showClient),
      showBarcode: bool(l.showBarcode, D.layout.showBarcode),
      showPayments: bool(l.showPayments, D.layout.showPayments),
      showDebt: bool(l.showDebt, D.layout.showDebt),
      bigTotal: bool(l.bigTotal, D.layout.bigTotal),
    },
  };
}

async function get() {
  const row = await Setting.findOne({ where: { key: KEY } });
  return sanitize(row ? row.value : DEFAULTS);
}

async function save(input) {
  const value = sanitize(input);
  const row = await Setting.findOne({ where: { key: KEY } });
  if (row) await row.update({ value });
  else await Setting.create({ key: KEY, value });
  return value;
}

module.exports = { get, save, sanitize, DEFAULTS };
