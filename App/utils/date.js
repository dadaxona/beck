'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** Bugungi sana MAHALLIY vaqt bo'yicha (YYYY-MM-DD). toISOString() UTC beradi va tunda kecha chiqib qoladi. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

module.exports = { today };
