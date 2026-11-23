const express = require('express');
const cors = require('cors');
const path = require('path');
const router = require('./App/routes/router');
const { sequelize } = require('./models');
const { syncSchema } = require('./database/sync');
const organizations = require('./App/services/organizations');
const app = express();
// Electron oynasi (main.js) va frontend (lib/config.ts) ham shu portga ulanadi. Testlar uchun PORT berish mumkin
const port = Number(process.env.PORT) || 5678;
const telegram = require('./App/services/telegram');
const { UPLOADS_DIR } = require('./App/services/productImages');

// X-New-Token: avtomatik yangilangan token (doim tizimda qolish) - brauzer o'qiy olishi uchun ochiladi
app.use(cors({ exposedHeaders: ['X-New-Token'] }))
// Haqiqiy mijoz IP si (cheklovlar uchun): standart - faqat shu kompyuterdagi proksi/tunnel (nginx, cloudflared, ngrok)
// sarlavhasiga ishoniladi. Boshqa sxemada: TRUST_PROXY=1 (proksilar soni) yoki IP/subnet ro'yxati.
const trustProxy = process.env.TRUST_PROXY || 'loopback';
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
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

syncSchema(sequelize) // jadvallar, yangi ustunlar va ko'p tashkilotli rejimga o'tish (eski ma'lumot 1-tashkilotga)
    // har bir tashkilotning standart yozuvlari: ombor, "Chakana mijoz", kassalar, modda, "Qora ro'yxat"
    .then(() => organizations.ensureAllDefaults())
    .then(() => {
        const server = app.listen(port, () => {
            console.log(`Example app listening on port ${port}`);
            markReady(port);
            // Telegram botlari (sozlangan bo'lsa) ulanadi
            telegram.applyAll().catch((err) => console.error('Telegram:', err.message));
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
