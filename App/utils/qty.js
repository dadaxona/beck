'use strict';

/**
 * Son (qoldiq) uchun yagona yaxlitlash va solishtirish.
 * Float qo'shish/ayirishda 0.19999999999999998 kabi qiymatlar chiqadi; har bir yozuvda 4 xonagacha
 * yaxlitlaymiz va solishtirishda kichik chegara (EPS) ishlatamiz, aks holda to'g'ri amallar rad etiladi.
 */
const EPS = 1e-6;
const roundQty = (v) => Math.round((Number(v) || 0) * 1e4) / 1e4;
const roundMoney = (v) => Math.round((Number(v) || 0) * 100) / 100;

module.exports = { EPS, roundQty, roundMoney };
