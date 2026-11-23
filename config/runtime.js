'use strict';

/**
 * Ishlash rejimi.
 *  - Lokal (Electron, bitta kompyuter): chek printeri shu kompyuterga ulangan - server orqali chop etiladi.
 *  - Server (ko'p tashkilotli platforma, internetdagi server): SERVER_MODE=1 yoki DATABASE_URL / NODE_ENV=production.
 *    Bu rejimda server o'zi printerga ulanmaydi: mijozlar printeri serverdan ko'rinmaydi va ixtiyoriy
 *    IP:port ga ulanish xavfsizlik teshigi (SSRF) bo'lardi.
 */
const SERVER_MODE =
  !process.versions.electron &&
  (process.env.SERVER_MODE === '1' || !!process.env.DATABASE_URL || process.env.NODE_ENV === 'production');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-forwarded-host', 'ngrok-trace-id'];

/**
 * So'rov aynan SHU kompyuterdan (Electron oynasi) keldimi: ulanish localhost dan va proksi/tunnel sarlavhalari yo'q.
 * Lokal dastur mini app'lar uchun tunnel (Cloudflare/ngrok) orqali internetga chiqarilganda tunnel so'rovlari ham
 * localhost dan keladi - lekin ular X-Forwarded-For / CF-Connecting-IP kabi sarlavhalar bilan keladi.
 */
function isLocalRequest(req) {
  const addr = req.socket && req.socket.remoteAddress;
  if (!LOOPBACK.has(addr)) return false;
  return !PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
}

/** Server tomonida chek printeriga ulanish mumkinmi (faqat lokal dasturda va shu kompyuterdan) */
const canPrintOnServer = (req) => !SERVER_MODE && isLocalRequest(req);

module.exports = { SERVER_MODE, isLocalRequest, canPrintOnServer };
