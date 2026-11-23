// Sahifaga faqat printer bilan ishlash uchun kichik va xavfsiz ko'prik (Node.js imkoniyatlari berilmaydi)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPrinter', {
  /** Shu kompyuterdagi Windows printerlar: [{ name, port, driver }] */
  list: () => ipcRenderer.invoke('printer:list'),
  /** printer: { type: 'usb'|'network', printerName, host, port }, data: ESC/POS baytlari (base64) */
  send: (printer, data) => ipcRenderer.invoke('printer:send', printer, data),
});

// AI yordamchi (ai-panel.js). Dastur faqat prompt va faylni qo'yadi - yuborishni foydalanuvchi o'zi bosadi.
// id: gemini | chatgpt | claude | deepseek | kimi
contextBridge.exposeInMainWorld('desktopAI', {
  /** AI saytini sahifadagi to'rtburchakka joylashtirish: { x, y, width, height } (CSS px) */
  show: (id, bounds) => ipcRenderer.invoke('ai:show', id, bounds),
  hide: () => ipcRenderer.invoke('ai:hide'),
  home: (id) => ipcRenderer.invoke('ai:home', id),
  /** { prompt, fileName, csv } - chatga prompt qo'yadi va CSV faylni biriktiradi */
  attach: (id, data) => ipcRenderer.invoke('ai:attach', id, data),
});
