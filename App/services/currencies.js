'use strict';

/**
 * Valyutalar va kurslar (Sozlamalar → Valyutalar). Bazada "currencies" kaliti ostida: [{ code, rate }].
 *
 *  UZS - asosiy valyuta (kurs = 1). Uni o'chirib, o'zgartirib bo'lmaydi.
 *  Boshqalar: "1 USD = 12 800 UZS" ko'rinishida (rate = 1 birlikning so'mdagi narxi).
 *
 * Kurs tarixi: har bir hujjat yaratilganda o'sha paytdagi kurs hujjatning o'zida saqlanadi (doc.rate).
 * Hisobotlarda:
 *  - hujjat o'z valyutasida ko'rsatilsa - asl summa;
 *  - boshqa valyutaga o'girilsa - summa hujjatdagi (o'sha paytdagi) kurs bo'yicha so'mga, so'mdan esa
 *    tanlangan valyutaga HOZIRGI kurs bo'yicha o'giriladi.
 */
const { Setting } = require('../../models');
const { currentOrg } = require('../../database/tenant');

const KEY = 'currencies';
const BASE = 'UZS';

const fail = (status, message) => Object.assign(new Error(message), { status });
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Kesh har bir tashkilot uchun alohida: { orgId -> [{ code, rate }] } (UZS siz)
const cache = new Map();

async function others() {
  const org = currentOrg();
  if (cache.has(org)) return cache.get(org);
  const row = await Setting.findOne({ where: { key: KEY } });
  const list = (Array.isArray(row && row.value) ? row.value : [])
    .filter((c) => c && typeof c.code === 'string' && c.code !== BASE && Number(c.rate) > 0)
    .map((c) => ({ code: c.code, rate: Number(c.rate) }));
  cache.set(org, list);
  return list;
}

async function write(list) {
  const row = await Setting.findOne({ where: { key: KEY } });
  if (row) await row.update({ value: list });
  else await Setting.create({ key: KEY, value: list });
  cache.set(currentOrg(), list);
}

/** Barcha valyutalar: birinchisi doim UZS */
async function list() {
  return [{ code: BASE, rate: 1, base: true }, ...(await others()).map((c) => ({ ...c, base: false }))];
}

/** { code -> rate } */
async function rates() {
  const map = { [BASE]: 1 };
  for (const c of await others()) map[c.code] = c.rate;
  return map;
}

/** Valyuta ro'yxatda bo'lmasa xato (hujjat saqlashda) */
async function assertKnown(code) {
  const r = await rates();
  if (!r[code]) throw fail(400, `Valyuta topilmadi: ${code}. Sozlamalar → Valyutalar bo'limida qo'shing`);
  return r[code];
}

/** Hozirgi kurs (noma'lum valyuta uchun 1) */
async function rateOf(code) {
  return (await rates())[code] || 1;
}

/**
 * Konverter (bir marta kurslarni olib, ko'p marta ishlatish uchun):
 *  conv(amount, fromCurrency, fromRate?, toCurrency)
 *   - bir xil valyuta: o'zgarmaydi;
 *   - aks holda: amount * (hujjat kursi yoki hozirgi kurs) / hozirgi kurs(to).
 */
async function converter() {
  const r = await rates();
  const cur = (code) => r[code] || 1;
  return (amount, from, fromRate, to) => {
    const a = Number(amount) || 0;
    if (!from || from === to) return a;
    return (a * (Number(fromRate) > 0 ? Number(fromRate) : cur(from))) / cur(to);
  };
}

/** Narxni hozirgi kurs bo'yicha boshqa valyutaga (2 xonagacha yaxlitlab) - frontenddagi bilan bir xil */
async function convertPrice(amount, from, to) {
  if (from === to) return Number(amount) || 0;
  const r = await rates();
  return round2(((Number(amount) || 0) * (r[from] || 1)) / (r[to] || 1));
}

const CODE_RE = /^[A-Z]{2,10}$/;

function clean(input) {
  const code = String((input && input.code) || '').trim().toUpperCase();
  const rate = Number(input && input.rate);
  if (!CODE_RE.test(code)) throw fail(400, 'Valyuta kodini kiriting (masalan USD, EUR, RUB)');
  if (code === BASE) throw fail(400, "UZS asosiy valyuta: uni o'zgartirib bo'lmaydi");
  if (!(rate > 0)) throw fail(400, "Kurs 0 dan katta bo'lishi kerak");
  if (rate > 1e9) throw fail(400, 'Kurs juda katta');
  return { code, rate: Math.round(rate * 10000) / 10000 };
}

async function add(input) {
  const c = clean(input);
  const list = await others();
  if (list.some((x) => x.code === c.code)) throw fail(409, `${c.code} valyutasi allaqachon bor`);
  await write([...list, c]);
  return list;
}

async function update(code, input) {
  const list = await others();
  const i = list.findIndex((x) => x.code === code);
  if (code === BASE) throw fail(400, "UZS asosiy valyuta: uni o'zgartirib bo'lmaydi");
  if (i < 0) throw fail(404, 'Valyuta topilmadi');
  const c = clean({ code, rate: input && input.rate });
  const next = [...list];
  next[i] = c;
  await write(next);
}

/** Hujjat yoki tovarda ishlatilgan valyuta o'chirilmaydi (kurs tarixi va narxlar buzilmasin) */
async function remove(code) {
  if (code === BASE) throw fail(400, "UZS asosiy valyuta: uni o'chirib bo'lmaydi");
  const list = await others();
  if (!list.some((x) => x.code === code)) throw fail(404, 'Valyuta topilmadi');
  const db = require('../../models');
  const { Op } = require('sequelize');
  const checks = [
    [db.Product, { currency: code }],
    [db.Sale, { currency: code }],
    [db.Receipt, { currency: code }],
    [db.SaleReturn, { currency: code }],
    [db.Payroll, { currency: code }],
    [db.WriteOff, { currency: code }],
    [db.CashDocument, { [Op.or]: [{ currency: code }, { accountCurrency: code }] }],
  ];
  for (const [model, where] of checks) {
    if (model && (await model.findOne({ where, attributes: ['id'] }))) {
      throw fail(409, `${code} valyutasi tovar yoki hujjatlarda ishlatilgan, o'chirib bo'lmaydi`);
    }
  }
  await write(list.filter((x) => x.code !== code));
}

module.exports = { BASE, list, rates, rateOf, assertKnown, converter, convertPrice, add, update, remove, round2 };
