'use strict';

/**
 * ESC/POS buyruqlar kodlovchisi (Xprinter XP-80 / XP-58 va boshqa ESC/POS printerlar).
 *
 *   const e = new EscPos({ width: 80, codepage: 'cp866' });
 *   e.align('center').size('lg').bold(true).line('DO'KON').bold(false).size('md').cut();
 *   const bytes = e.encode();
 */
const iconv = require('iconv-lite');

const ESC = 0x1b;
const GS = 0x1d;

/** Kod sahifalari: nomi -> { iconv kodlash, ESC t raqami } */
const CODEPAGES = {
  cp866: { encoding: 'cp866', table: 17, label: 'CP866 (kirill, DOS)' },
  cp1251: { encoding: 'win1251', table: 46, label: 'Windows-1251 (kirill)' },
  cp437: { encoding: 'cp437', table: 0, label: 'CP437 (faqat lotin)' },
};

/** Qog'oz kengligi -> bir qatordagi belgilar soni (A shrift) */
const COLUMNS = { 80: 48, 58: 32 };

/** Printerda yo'q belgilarni xavfsiz ekvivalentga almashtirish */
function sanitize(text) {
  return String(text ?? '')
    .replace(/[ʻʼ‘’`´]/g, "'") // o'zbekcha tutuq belgilari
    .replace(/[“”«»]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/×/g, 'x')
    .replace(/→/g, '->')
    .replace(/[   ]/g, ' ') // toLocaleString bo'shliqlari
    .replace(/…/g, '...');
}

class EscPos {
  /**
   * @param {{ width?: 58|80, codepage?: string, codepageTable?: number }} options
   */
  constructor({ width = 80, codepage = 'cp866', codepageTable } = {}) {
    this.width = width;
    this.cp = CODEPAGES[codepage] || CODEPAGES.cp866;
    this.table = Number.isInteger(codepageTable) ? codepageTable : this.cp.table;
    this.chunks = [];
    this.state = { size: 'md', bold: false, align: 'left' };
    this.raw([ESC, 0x40]); // initialize
    this.raw([ESC, 0x74, this.table]); // kod sahifasi
  }

  /** Joriy shrift o'lchamida bir qatordagi belgilar soni */
  get columns() {
    const base = COLUMNS[this.width] || 48;
    if (this.state.size === 'sm') return Math.floor(base * 1.33); // B shrift
    if (this.state.size === 'xl') return Math.floor(base / 2); // ikki barobar keng
    return base;
  }

  raw(bytes) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  text(str) {
    this.chunks.push(iconv.encode(sanitize(str), this.cp.encoding));
    return this;
  }

  newline(n = 1) {
    return this.raw(Array(n).fill(0x0a));
  }

  line(str = '') {
    return this.text(str).newline();
  }

  align(value) {
    this.state.align = value;
    return this.raw([ESC, 0x61, value === 'center' ? 1 : value === 'right' ? 2 : 0]);
  }

  bold(on) {
    this.state.bold = Boolean(on);
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  /** sm — B shrift, md — oddiy, lg — ikki barobar baland, xl — ikki barobar baland va keng */
  size(value) {
    this.state.size = value;
    this.raw([ESC, 0x4d, value === 'sm' ? 1 : 0]);
    const n = value === 'lg' ? 0x01 : value === 'xl' ? 0x11 : 0x00;
    return this.raw([GS, 0x21, n]);
  }

  /** Chap va o'ng matn bir qatorda (o'ng tomonga tekislangan) */
  row(left, right) {
    const cols = this.columns;
    const l = sanitize(left);
    const r = sanitize(right);
    if (l.length + r.length + 1 > cols) {
      // Sig'masa: chap matn alohida qatorlarga, summa oxirgi qatorda o'ngda
      const lines = wrap(l, cols);
      const last = lines.pop();
      lines.forEach((x) => this.line(x));
      if (last.length + r.length + 1 <= cols) return this.line(last + ' '.repeat(cols - last.length - r.length) + r);
      this.line(last);
      return this.line(' '.repeat(Math.max(0, cols - r.length)) + r);
    }
    return this.line(l + ' '.repeat(cols - l.length - r.length) + r);
  }

  /** Uzun matnni so'zlar bo'yicha qatorlarga bo'lib chiqarish */
  wrapped(str, indent = 0) {
    const pad = ' '.repeat(indent);
    for (const part of String(str ?? '').split('\n')) {
      for (const ln of wrap(sanitize(part), this.columns - indent)) this.line(pad + ln);
    }
    return this;
  }

  divider(char = '-') {
    return this.line((char || '-').slice(0, 1).repeat(this.columns));
  }

  feed(lines = 1) {
    return this.raw([ESC, 0x64, Math.max(0, Math.min(255, lines))]);
  }

  /** Qog'ozni surib kesish (qisman kesish) */
  cut() {
    return this.raw([GS, 0x56, 0x42, 0x03]);
  }

  /** Pul qutisini ochish (printerning RJ11 porti, 2-pin) */
  drawer() {
    return this.raw([ESC, 0x70, 0x00, 0x19, 0xfa]);
  }

  /** Ovozli signal (Xprinter: ESC B n t) */
  beep(times = 2, duration = 2) {
    return this.raw([ESC, 0x42, times, duration]);
  }

  /**
   * Rastr rasm (logotip): 1-bitli piksellar massivi.
   * @param {{ width: number, height: number, pixels: Uint8Array }} img  pixels[i] = 1 qora
   */
  image({ width, height, pixels }) {
    const bytesPerRow = Math.ceil(width / 8);
    const data = Buffer.alloc(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    this.raw([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff]);
    this.chunks.push(data);
    return this;
  }

  encode() {
    return Buffer.concat(this.chunks);
  }
}

/** So'zlar bo'yicha qatorlarga bo'lish (juda uzun so'zlar majburan bo'linadi) */
function wrap(text, width) {
  const out = [];
  let current = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (word.length > width) {
      if (current) out.push(current);
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      current = out.pop();
      continue;
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ' ' + word;
    else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

/**
 * Chekning matnli ko'rinishi (Sozlamalar oynasidagi oldindan ko'rish uchun): EscPos bilan bir xil buyruqlar,
 * lekin baytlar o'rniga qatorlar yig'iladi { text, align, size, bold }.
 */
class TextPreview {
  constructor({ width = 80 } = {}) {
    this.width = width;
    this.lines = [];
    this.state = { size: 'md', bold: false, align: 'left' };
  }

  get columns() {
    const base = COLUMNS[this.width] || 48;
    if (this.state.size === 'sm') return Math.floor(base * 1.33);
    if (this.state.size === 'xl') return Math.floor(base / 2);
    return base;
  }

  line(str = '') {
    this.lines.push({ text: sanitize(str), ...this.state });
    return this;
  }

  text(str) {
    return this.line(str);
  }

  newline(n = 1) {
    for (let i = 0; i < n; i++) this.line('');
    return this;
  }

  align(value) {
    this.state.align = value;
    return this;
  }

  bold(on) {
    this.state.bold = Boolean(on);
    return this;
  }

  size(value) {
    this.state.size = value;
    return this;
  }

  row(left, right) {
    return EscPos.prototype.row.call(this, left, right);
  }

  wrapped(str, indent = 0) {
    return EscPos.prototype.wrapped.call(this, str, indent);
  }

  divider(char = '-') {
    return this.line((char || '-').slice(0, 1).repeat(this.columns));
  }

  feed() {
    return this;
  }

  cut() {
    this.lines.push({ text: '', align: 'left', size: 'md', bold: false, cut: true });
    return this;
  }

  drawer() {
    return this;
  }

  beep() {
    return this;
  }

  image() {
    return this;
  }
}

module.exports = { EscPos, TextPreview, CODEPAGES, COLUMNS, sanitize, wrap };
