const { Router } = require('express');
const mini = require('../controllers/miniAppController');
const auth = require('../middlewares/auth');

/**
 * Telegram mini app'lar uchun ochiq yo'llar (/api/mini/...).
 * Mijoz so'rovlari Telegram initData imzosi bilan (X-Telegram-Init-Data sarlavhasi) tekshiriladi.
 * Xodimlar initData orqali token oladi, keyin oddiy /api yo'llaridan (roliga qarab) foydalanadi.
 */
const router = Router();

router.get('/shop/info', mini.shopInfo);
router.get('/shop/products', mini.shopProducts);
router.post('/shop/orders', mini.shopOrder);
router.get('/shop/orders', mini.shopMyOrders);

router.post('/agent/session', mini.agentSession);
router.post('/agent/login', mini.agentLogin);
router.get('/agent/me', auth, mini.agentMe);
router.post('/agent/logout', auth, mini.agentLogout);

router.use((req, res) => res.status(404).json({ message: 'Topilmadi' }));

module.exports = router;
