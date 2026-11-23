// Sahifaga faqat printer bilan ishlash uchun kichik va xavfsiz ko'prik (Node.js imkoniyatlari berilmaydi)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPrinter', {
  /** Shu kompyuterdagi Windows printerlar: [{ name, port, driver }] */
  list: () => ipcRenderer.invoke('printer:list'),
  /** printer: { type: 'usb'|'network', printerName, host, port }, data: ESC/POS baytlari (base64) */
  send: (printer, data) => ipcRenderer.invoke('printer:send', printer, data),
});

// AI yordamchi (Gemini paneli, ai-panel.js). Dastur faqat prompt va faylni qo'yadi - yuborishni foydalanuvchi o'zi bosadi
contextBridge.exposeInMainWorld('desktopAI', {
  /** Gemini panelini sahifadagi to'rtburchakka joylashtirish: { x, y, width, height } (CSS px) */
  show: (bounds) => ipcRenderer.invoke('ai:show', bounds),
  hide: () => ipcRenderer.invoke('ai:hide'),
  home: () => ipcRenderer.invoke('ai:home'),
  /** { prompt, fileName, csv } - chatga prompt qo'yadi va CSV faylni biriktiradi */
  attach: (data) => ipcRenderer.invoke('ai:attach', data),
});
