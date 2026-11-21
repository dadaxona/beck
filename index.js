const express = require('express');
const cors = require('cors');
const path = require('path');
const router = require('./App/routes/router');
const { sequelize, Warehouse, Contractor, CashDesk, CashArticle } = require('./models');
const { syncSchema } = require('./database/sync');
const { ensureCategory: ensureBlacklistCategory } = require('./App/services/blacklist');
const app = express();
// Electron oynasi (main.js) va frontend (lib/config.ts) ham shu portga ulanadi. Testlar uchun PORT berish mumkin
const port = Number(process.env.PORT) || 5678;
const telegram = require('./App/services/telegram');
const { UPLOADS_DIR } = require('./App/services/productImages');

app.use(cors())
app.use(express.json({ limit: '25mb' })) // Excel import fayli (base64) sig'ishi uchun
app.use(express.urlencoded({ extended: false }))

app.use('/api', require('./App/middlewares/lang'))
// Telegram mini app'lar (ochiq yo'llar, initData imzosi bilan)
app.use('/api/mini', require('./App/routes/miniapp'))
app.use('/api', router)
app.use('/api', (err, req, res, next) => {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Server xatosi' });
})

// Tovar rasmlari
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', fallthrough: false }))

// Frontend (next build -> public). /login -> login.html va h.k.
const publicDir = path.join(__dirname, 'public');
// /login -> login.html (public/login/ papkasi bilan to'qnashmasligi uchun o'zimiz hal qilamiz)
app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api') || path.extname(req.path)) return next();
    const file = path.join(publicDir, req.path === '/' ? 'index' : req.path) + '.html';
    if (!file.startsWith(publicDir)) return next();
    res.sendFile(file, (err) => (err ? next() : undefined));
})
// Next prefetch: /x/__next.x.__PAGE__.txt so'raydi, fayl esa /x/__next.x/__PAGE__.txt da turadi
app.use((req, res, next) => {
    req.url = req.url.replace(/\/(__next\.[^./?]+)\.([^/?]+)\.txt/, '/$1/$2.txt');
    next();
})
app.use(express.static(publicDir, { redirect: false }))
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ message: 'Topilmadi' });
    }
    res.status(404).sendFile(path.join(publicDir, '404.html'), (err) => {
        if (err) res.status(404).send('Not found');
    });
})

// Server tayyor bo'lganini bildiradi (Electron oynasi shuni kutib, keyin sahifani ochadi)
let markReady;
let markFailed;
const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
});
ready.catch(() => { }); // kutayotgan bo'lmasa "unhandled rejection" bo'lmasin

syncSchema(sequelize) // jadvallar va yangi ustunlar modellardan avtomatik
    .then(() => Warehouse.findOrCreate({ where: { name: 'Asosiy' } })) // standart ombor
    .then(() => Contractor.findOrCreate({ where: { name: 'Chakana mijoz' }, defaults: { relation: 'B2C' } })) // sotuv oynasidagi standart mijoz
    // standart kassalar va modda (ketma-ket: SQLite parallel transaction'ni qabul qilmaydi)
    .then(() => CashDesk.findOrCreate({ where: { name: 'Naqd' } }))
    .then(() => CashDesk.findOrCreate({ where: { name: 'Plastik' } }))
    .then(() => CashDesk.findOrCreate({ where: { name: 'Bank' } }))
    .then(() => CashArticle.findOrCreate({ where: { name: "To'lov" } }))
    .then(() => ensureBlacklistCategory()) // "Qora ro'yxat" kategoriyasi; avval belgilanganlar ham unga tushadi
    .then((cat) => Contractor.update({ categoryId: cat.id }, { where: { blacklisted: true } }))
    .then(() => {
        const server = app.listen(port, () => {
            console.log(`Example app listening on port ${port}`);
            markReady(port);
            // Telegram botlari (sozlangan bo'lsa) ulanadi
            telegram.apply().catch((err) => console.error('Telegram:', err.message));
        });
        server.on('error', (err) => markFailed(err)); // masalan: port band (dastur ikkinchi marta ochilgan)
    })
    .catch((err) => {
        console.error('Database error:', err);
        markFailed(err);
        // Electron ichida jarayonni o'ldirmaymiz: oyna xatoni ko'rsatadi
        if (!process.versions.electron) process.exit(1);
    });

module.exports = app;
module.exports.ready = ready;
