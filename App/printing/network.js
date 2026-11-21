'use strict';

/**
 * LAN (Ethernet) printer: ESC/POS baytlari to'g'ridan-to'g'ri IP:9100 ga yuboriladi.
 * Xprinter LAN modellari standart 9100-portni tinglaydi.
 */
const net = require('net');

function sendNetwork({ host, port = 9100, timeoutMs = 7000 }, data) {
  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error('Printer IP manzili kiritilmagan'));
    const socket = net.createConnection({ host, port: Number(port) || 9100 });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`Printer javob bermadi (${host}:${port})`)));
    socket.on('error', (err) => {
      const map = {
        ECONNREFUSED: `Printer ulanishni rad etdi (${host}:${port}) — port to'g'riligini tekshiring`,
        EHOSTUNREACH: `Printer topilmadi (${host}) — kabel va IP manzilni tekshiring`,
        ETIMEDOUT: `Printer javob bermadi (${host}:${port})`,
        ENOTFOUND: `Manzil noto'g'ri: ${host}`,
      };
      finish(new Error(map[err.code] || err.message));
    });
    socket.on('connect', () => {
      socket.write(data, (err) => {
        if (err) return finish(err);
        socket.end();
      });
    });
    socket.on('close', () => finish());
  });
}

module.exports = { sendNetwork };
