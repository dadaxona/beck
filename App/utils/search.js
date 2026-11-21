'use strict';

/**
 * Matn qidiruvi - har qanday bazada (SQLite, PostgreSQL, MySQL) bir xil natija.
 *
 * Nega SQL LIKE emas: SQLite LIKE faqat lotin harflarida katta-kichik harfni farqlamaydi ("вин" "Вин" ni topmaydi),
 * PostgreSQL LIKE esa umuman farqlaydi, MySQL - collation ga bog'liq. Shuning uchun qidiruv JavaScript da
 * (Unicode bo'yicha to'liq) qilinadi.
 *
 * Normallashtirish: kichik harf, o'zbekcha apostroflar (o' o‘ o’ oʻ) bir xil, "ё" = "е", ortiqcha bo'sh joylar.
 */
const norm = (s) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

/**
 * matcher(q) -> (fields, phones?) => boolean
 *  fields - qidiriladigan matnlar (nomi, shtrix-kod, INN ...)
 *  phones - telefonlar: raqamlar bo'yicha ham qidiriladi ("901234567" -> "+998 90 123 45 67")
 * q bo'sh bo'lsa null (filtrlash shart emas).
 */
function matcher(q) {
  const needle = norm(q).trim();
  if (!needle) return null;
  const digits = needle.replace(/\D/g, '');
  return (fields, phones = []) =>
    fields.some((v) => norm(v).includes(needle)) ||
    (digits.length >= 3 && phones.some((p) => String(p || '').replace(/\D/g, '').includes(digits)));
}

/** Nom bo'yicha tartiblash: barcha bazalarda bir xil (SQLite ORDER BY kirillchada katta-kichik harfni ajratadi) */
const collator = new Intl.Collator(['uz', 'ru'], { sensitivity: 'base', numeric: true });
const byName = (a, b) => collator.compare(String(a.name || ''), String(b.name || ''));

module.exports = { norm, matcher, byName };
