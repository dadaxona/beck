// Sahifaga faqat printer bilan ishlash uchun kichik va xavfsiz ko'prik (Node.js imkoniyatlari berilmaydi)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPrinter', {
  /** Shu kompyuterdagi Windows printerlar: [{ name, port, driver }] */
  list: () => ipcRenderer.invoke('printer:list'),
  /** printer: { type: 'usb'|'network', printerName, host, port }, data: ESC/POS baytlari (base64) */
  send: (printer, data) => ipcRenderer.invoke('printer:send', printer, data),
});
