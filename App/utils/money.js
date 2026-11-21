'use strict';

/** Summa matn ko'rinishida: 1250000 -> "1 250 000" (Telegram xabarlari uchun) */
const money = (n) =>
  String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

module.exports = { money };
