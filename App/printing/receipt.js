'use strict';

/**
 * Sotuv cheki (XP-80 / XP-58): sozlamalardagi maket bo'yicha ESC/POS baytlari yoki
 * oldindan ko'rish uchun matn qatorlari. Ikkalasi ham bitta funksiyadan chiqadi, shuning uchun
 * Sozlamalardagi ko'rinish chop etilgan chek bilan bir xil bo'ladi.
 */
const { EscPos, TextPreview } = require('./encoder');

const numFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const num = (v) => numFmt.format(Number(v) || 0).replace(/\s/g, ' ');
const qty = (v) => qtyFmt.format(Number(v) || 0).replace(/\s/g, ' ');
const dateTime = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const LABELS = {
  uz: {
    sale: 'SOTUV CHEKI',
    basket: 'SAVAT (QARZGA)',
    date: 'Sana',
    cashier: 'Kassir',
    client: 'Mijoz',
    goods: 'Tovarlar',
    markup: 'Ustama',
    discount: 'Chegirma',
    returned: 'Qaytarilgan',
    total: 'JAMI',
    paid: "To'langan",
    debt: 'Qarz',
    test: 'SINOV CHEKI',
    printer: 'Printer',
    paper: "Qog'oz",
    codepage: 'Kod sahifasi',
  },
  ru: {
    sale: 'ТОВАРНЫЙ ЧЕК',
    basket: 'ПРОДАЖА В ДОЛГ',
    date: 'Дата',
    cashier: 'Кассир',
    client: 'Клиент',
    goods: 'Товары',
    markup: 'Наценка',
    discount: 'Скидка',
    returned: 'Возврат',
    total: 'ИТОГО',
    paid: 'Оплачено',
    debt: 'Долг',
    test: 'ТЕСТОВЫЙ ЧЕК',
    printer: 'Принтер',
    paper: 'Бумага',
    codepage: 'Кодовая страница',
  },
};

const encoderFor = (printer, preview) =>
  preview
    ? new TextPreview({ width: printer.width })
    : new EscPos({ width: printer.width, codepage: printer.codepage, codepageTable: printer.codepageTable ?? undefined });

/** Do'kon nomi va sarlavha qatorlari */
function head(e, layout) {
  e.align('center');
  if (layout.shopName.trim()) e.size('lg').bold(true).wrapped(layout.shopName).size('md').bold(false);
  for (const line of layout.header.split('\n').filter((x) => x.trim())) e.wrapped(line);
  e.align('left');
}

function tail(e, layout, printer, { drawer, preview }) {
  if (layout.footer.trim()) {
    e.divider();
    e.align('center');
    for (const line of layout.footer.split('\n').filter((x) => x.trim())) e.wrapped(line);
    e.align('left');
  }
  e.feed(4);
  if (printer.cut) e.cut();
  if (preview) return e.lines;
  const one = e.encode();
  // Nusxalar: har biri alohida kesiladi; pul qutisi faqat bir marta ochiladi
  const parts = Array.from({ length: printer.copies || 1 }, () => one);
  if (drawer) parts.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  return Buffer.concat(parts);
}

/**
 * Sotuv cheki.
 * @param sale    saleController.loadDoc natijasi (tovarlar, to'lovlar, mijoz, kassir, qarz)
 * @param settings receiptSettings.get() natijasi
 * @param preview true bo'lsa matn qatorlari qaytadi (ko'rinish uchun)
 */
function renderSale(sale, settings, preview = false) {
  const { printer, layout } = settings;
  const L = LABELS[layout.language] || LABELS.uz;
  const e = encoderFor(printer, preview);
  const cur = sale.currency || 'UZS';

  head(e, layout);
  e.divider();
  e.align('center').bold(true).line(`${sale.onCredit ? L.basket : L.sale} № ${sale.number}`).bold(false).align('left');
  e.row(L.date, dateTime(sale.createdAt || sale.date));
  if (layout.showCashier && sale.cashier) e.row(L.cashier, sale.cashier.name);
  if (layout.showClient && sale.client && sale.namedClient) e.row(L.client, sale.client.name);
  e.divider();

  for (const i of sale.items || []) {
    e.wrapped(i.product ? i.product.name : `#${i.productId}`);
    if (layout.showBarcode && i.product && i.product.barcode) e.wrapped(i.product.barcode, 2);
    e.row(`  ${qty(i.quantity)} x ${num(i.price)}`, num(i.sum));
  }
  e.divider();

  if (Math.abs(sale.markup) > 0.005) {
    e.row(L.goods, num(sale.subtotal));
    e.row(sale.markup > 0 ? L.markup : L.discount, `${sale.markup > 0 ? '+' : '-'}${num(Math.abs(sale.markup))}`);
  }
  if (sale.returnedTotal > 0.005) e.row(L.returned, `-${num(sale.returnedTotal)}`);

  const total = sale.total - (sale.returnedTotal || 0);
  if (layout.bigTotal) e.size('lg').bold(true);
  else e.bold(true);
  e.row(L.total, `${num(total)} ${cur}`);
  e.size('md').bold(false);

  if (layout.showPayments) {
    for (const p of sale.payments || []) e.row(p.cashDesk ? p.cashDesk.name : L.paid, num(p.amount));
  }
  if (layout.showDebt && sale.onCredit) {
    e.row(L.paid, num(sale.paid));
    if (sale.debt > 0.005) e.bold(true).row(L.debt, `${num(sale.debt)} ${cur}`).bold(false);
  }

  // Pul qutisi: faqat sotuv vaqtida pul olingan bo'lsa (naqd/karta to'lovi)
  const drawer = printer.drawer && (sale.payments || []).some((p) => p.amount > 0);
  return tail(e, layout, printer, { drawer, preview });
}

/** Sozlamalarni tekshirish uchun namunaviy sotuv (oldindan ko'rish) */
function sampleSale() {
  return {
    number: 'S-125',
    onCredit: false,
    namedClient: true,
    createdAt: new Date().toISOString(),
    currency: 'UZS',
    cashier: { name: 'Dilshot' },
    client: { name: 'Ali Valiyev' },
    items: [
      { productId: 1, quantity: 1, price: 760000, sum: 760000, product: { name: 'Камера IP B 140 HAP-LUF / SL PRO police', barcode: 'GD4679660' } },
      { productId: 2, quantity: 2, price: 60000, sum: 120000, product: { name: 'Кранштейн для тв СТ 1543', barcode: '' } },
      { productId: 3, quantity: 1, price: 200000, sum: 200000, product: { name: 'Установка камера туман', barcode: '' } },
    ],
    subtotal: 1080000,
    markup: -30000,
    total: 1050000,
    returnedTotal: 0,
    paid: 1050000,
    debt: 0,
    payments: [{ amount: 1050000, cashDesk: { name: 'Naqd' } }],
  };
}

/** Sinov cheki: printer ulanishi va kirill harflarini tekshirish */
function renderTest(settings, preview = false) {
  const { printer, layout } = settings;
  const L = LABELS[layout.language] || LABELS.uz;
  const e = encoderFor(printer, preview);
  head(e, layout);
  e.divider();
  e.align('center').size('lg').bold(true).line(L.test).size('md').bold(false).align('left');
  e.row(L.printer, printer.type === 'network' ? `${printer.host}:${printer.port}` : printer.printerName || '-');
  e.row(L.paper, `${printer.width} mm`);
  e.row(L.codepage, printer.codepageTable ?? printer.codepage);
  e.row(L.date, dateTime(new Date()));
  e.divider();
  e.line("Lotin: O'zbekiston, g'isht, cho'l");
  e.line('Kirill: Ассалому алайкум, Ўзбекистон');
  e.line('Raqamlar: 1 234 567,89');
  e.divider('=');
  e.align('center').size('xl').line('OK').size('md').align('left');
  return tail(e, { ...layout, footer: '' }, { ...printer, copies: 1 }, { drawer: false, preview });
}

module.exports = { renderSale, renderTest, sampleSale };
