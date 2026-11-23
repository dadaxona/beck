const { Router } = require('express');
const mini = require('../controllers/miniAppController');
const auth = require('../middlewares/auth');
const { Organization } = require('../../models');
const { runWithOrg } = require('../../database/tenant');

/**
 * Telegram mini app'lar uchun ochiq yo'llar (/api/mini/...).
 * Ko'p tashkilotli rejim: mini app qaysi tashkilotniki - manzildagi ?o=<id> (frontend X-Org sarlavhasida yuboradi).
 * Mijoz so'rovlari o'sha tashkilot botining initData imzosi bilan tekshiriladi.
 * Xodimlar initData orqali token oladi, keyin oddiy /api yo'llaridan (roliga qarab) foydalanadi.
 */
const router = Router();

// Token bilan (tashkilot foydalanuvchidan olinadi)
router.get('/agent/me', auth, mini.agentMe);
router.post('/agent/logout', auth, mini.agentLogout);

// Qolganlari: tashkilot X-Org sarlavhasi yoki ?o= parametridan
router.use(async (req, res, next) => {
  const id = Number(req.headers['x-org'] || req.query.o);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Do'kon aniqlanmadi. Mini app'ni bot orqali oching" });
  const org = await Organization.findByPk(id);
  if (!org || !org.active) return res.status(404).json({ message: "Do'kon topilmadi" });
  runWithOrg(org.id, () => next());
});

router.get('/shop/info', mini.shopInfo);
router.get('/shop/products', mini.shopProducts);
router.post('/shop/orders', mini.shopOrder);
router.get('/shop/orders', mini.shopMyOrders);

router.post('/agent/session', mini.agentSession);
router.post('/agent/login', mini.agentLogin);

router.use((req, res) => res.status(404).json({ message: 'Topilmadi' }));

module.exports = router;
