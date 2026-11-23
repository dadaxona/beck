const printing = require('../printing');
const { renderSale, renderTest, sampleSale } = require('../printing/receipt');
const { CODEPAGES } = require('../printing/encoder');
const receiptSettings = require('../services/receiptSettings');
const { loadDoc } = require('./saleController');

const fail = (status, message) => Object.assign(new Error(message), { status });
const { canPrintOnServer } = require('../../config/runtime');

/**
 * Server rejimida (internetdagi ko'p tashkilotli server) server printerga ulanmaydi: mijozning printeri serverdan
 * ko'rinmaydi, ixtiyoriy IP:port ga ulanish esa xavfsizlik teshigi (SSRF). Chek A4 / brauzer orqali chop etiladi.
 */
const SERVER_PRINT_OFF = "Chek printeri faqat dastur o'rnatilgan kompyuterdan ishlaydi: A4 yoki brauzer orqali chop eting";

const configured = (p) => (p.type === 'network' ? !!p.host : !!p.printerName);

/**
 * ?render=1 - chek printerga yuborilmaydi, tayyor ESC/POS baytlari (base64) qaytariladi.
 * Kompyuterdagi dastur (Electron) ularni o'zi lokal USB / LAN printerga yuboradi (server rejimida ham).
 */
const wantsRender = (req) => req.query.render === '1';
const rendered = (res, printer, data) => res.json({ printer, data: Buffer.from(data).toString('base64') });
const NOT_CONFIGURED = "Printer sozlanmagan: Sozlamalar → Chek va printer bo'limida printerni tanlang";

// GET /print/settings - chek va printer sozlamalari
exports.getSettings = async (req, res) => {
  res.json({
    settings: await receiptSettings.get(),
    codepages: Object.entries(CODEPAGES).map(([key, c]) => ({ key, label: c.label, table: c.table })),
  });
};

// PUT /print/settings
exports.saveSettings = async (req, res) => {
  res.json({ settings: await receiptSettings.save(req.body?.settings || req.body) });
};

// GET /print/printers - Windows'dagi printerlar (USB printer drayveri o'rnatilgan bo'lishi kerak)
exports.printers = async (req, res) => {
  if (!canPrintOnServer(req)) return res.json([]);
  res.json(await printing.listPrinters());
};

// POST /print/preview { settings } - saqlanmagan sozlamalar bilan namunaviy chek ko'rinishi
exports.preview = async (req, res) => {
  const settings = receiptSettings.sanitize(req.body?.settings || (await receiptSettings.get()));
  res.json({ lines: renderSale(sampleSale(), settings, true), columns: settings.printer.width === 58 ? 32 : 48 });
};

// POST /print/test { settings? } - sinov cheki (saqlanmagan sozlamalar bilan ham sinash mumkin)
exports.test = async (req, res) => {
  const settings = req.body?.settings ? receiptSettings.sanitize(req.body.settings) : await receiptSettings.get();
  if (!configured(settings.printer)) throw fail(400, 'Printer tanlanmagan');
  if (wantsRender(req)) return rendered(res, settings.printer, renderTest(settings));
  if (!canPrintOnServer(req)) throw fail(400, SERVER_PRINT_OFF);
  try {
    await printing.send(settings.printer, renderTest(settings));
  } catch (err) {
    throw fail(502, `Chek chiqmadi: ${err.message}`);
  }
  res.json({ printed: true });
};

// POST /print/sale/:id?auto=1 - sotuv cheki. auto=1: sotuvdan keyin avtomatik (sozlamada yoqilgan bo'lsa)
exports.sale = async (req, res) => {
  const auto = req.query.auto === '1';
  const settings = await receiptSettings.get();
  if (auto && !settings.printer.autoPrint) return res.json({ printed: false, reason: 'off' });
  if (wantsRender(req)) {
    if (!configured(settings.printer)) throw fail(400, NOT_CONFIGURED);
    const doc = await loadDoc(Number(req.params.id));
    if (!doc) throw fail(404, 'Sotuv topilmadi');
    return rendered(res, settings.printer, renderSale(doc, settings));
  }
  if (!canPrintOnServer(req)) {
    if (auto) return res.json({ printed: false, reason: 'server-mode' });
    throw fail(400, SERVER_PRINT_OFF);
  }
  if (!configured(settings.printer)) {
    if (auto) return res.json({ printed: false, reason: 'not-configured' });
    throw fail(400, NOT_CONFIGURED);
  }
  const sale = await loadDoc(Number(req.params.id));
  if (!sale) throw fail(404, 'Sotuv topilmadi');
  try {
    await printing.send(settings.printer, renderSale(sale, settings));
  } catch (err) {
    throw fail(502, `Chek chiqmadi: ${err.message}`);
  }
  res.json({ printed: true });
};

// GET /organization - tashkilot nomi (Sozlamalar → Chek va printer). Hujjatlarda (akt sverka va b.) chiqadi,
// shuning uchun tizimga kirgan har bir foydalanuvchiga ochiq.
exports.organization = async (req, res) => {
  const { layout } = await receiptSettings.get();
  res.json({ name: layout.shopName.trim() });
};

// GET /print/a4 - A4 hujjat sozlamalari (sotuvni A4 da chop etish uchun ham kerak)
const a4Settings = require('../services/a4Settings');
exports.getA4 = async (req, res) => {
  res.json(await a4Settings.get());
};

// PUT /print/a4
exports.saveA4 = async (req, res) => {
  res.json(await a4Settings.save(req.body || {}));
};
