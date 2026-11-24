const { Router } = require('express')
const authController = require('../controllers/authController')
const categoryController = require('../controllers/categoryController')
const contractorController = require('../controllers/contractorController')
const productController = require('../controllers/productController')
const productCategoryController = require('../controllers/productCategoryController')
const productExcelController = require('../controllers/productExcelController')
const warehouseController = require('../controllers/warehouseController')
const receiptController = require('../controllers/receiptController')
const saleController = require('../controllers/saleController')
const cashController = require('../controllers/cashController')
const payrollController = require('../controllers/payrollController')
const saleReturnController = require('../controllers/saleReturnController')
const reportController = require('../controllers/reportController')
const writeOffController = require('../controllers/writeOffController')
const userController = require('../controllers/userController')
const roleController = require('../controllers/roleController')
const printController = require('../controllers/printController')
const orderController = require('../controllers/orderController')
const telegramController = require('../controllers/telegramController')
const currencyController = require('../controllers/currencyController')
const transferController = require('../controllers/transferController')
const investmentController = require('../controllers/investmentController')
const auth = require('../middlewares/auth')
const { permit, permitAny } = require('../middlewares/permit')
const router = Router();

router.post('/auth/login', authController.login)
router.get('/auth/setup', authController.setup)
router.post('/auth/register', authController.register)

// Quyidagilar faqat login qilganlar uchun
router.use(auth)

router.get('/auth/me', authController.me)
router.get('/organization', printController.organization)

/*
 * Ruxsatlar (rolga qarab). Qoidalar:
 *  - Hujjatlarni yaratish/o'zgartirish/o'chirish: o'z bo'limining create/edit/delete ruxsati.
 *  - Hujjatni o'qish: o'z bo'limi YOKI uni ochadigan hisobotlar (akt sverka, debitor-kreditor, kontragent hisob-kitobi).
 *  - Hujjatlarni to'ldirish uchun kerak spravochniklar (tovar, kontragent, ombor, kassa ro'yxati)
 *    tizimga kirgan har bir foydalanuvchiga ochiq.
 */
const readSale = permitAny(['sales'], ['sales-journal'], ['basket'], ['returns'], ['reconciliation'], ['debtors'], ['contractors'])
const readDoc = (section) => permitAny([section], ['reconciliation'], ['debtors'], ['contractors'])
const readMoney = permitAny(['contractors'], ['cash'], ['payroll'], ['sales'], ['receipts'], ['returns'], ['basket'], ['reconciliation'], ['debtors'])

// Kontragent kategoriyalari
router.get('/categories', categoryController.list)
router.post('/categories', permit('contractors', 'create'), categoryController.create)
router.delete('/categories/:id', permit('contractors', 'delete'), categoryController.remove)

// Tovar kategoriyalari
router.get('/product-categories', productCategoryController.list)
router.post('/product-categories', permit('products', 'create'), productCategoryController.create)
router.delete('/product-categories/:id', permit('products', 'delete'), productCategoryController.remove)

router.get('/contractors', contractorController.list)
router.post('/contractors', permit('contractors', 'create'), contractorController.create)
router.post('/contractors/blacklist', permit('contractors', 'edit'), contractorController.blacklist)
router.post('/contractors/assign', permit('contractors', 'edit'), contractorController.assign)
router.put('/contractors/:id', permit('contractors', 'edit'), contractorController.update)
router.delete('/contractors/:id', permit('contractors', 'delete'), contractorController.remove)
router.post('/contractors/:id/restore', permit('contractors', 'delete'), contractorController.restore)
router.delete('/contractors/:id/purge', permit('contractors', 'purge'), contractorController.purge)

router.get('/products', productController.list)
// Excel: import (yaratish va o'zgartirish ruxsati kerak) va export
router.get('/products/export', permit('products'), productExcelController.export)
router.post('/products/import', permit('products', 'create'), permit('products', 'edit'), productExcelController.import)
router.post('/products', permit('products', 'create'), productController.create)
router.post('/products/assign', permit('products', 'edit'), productController.assign)
router.put('/products/:id', permit('products', 'edit'), productController.update)
router.post('/products/:id/image', permit('products', 'edit'), productController.uploadImage)
router.delete('/products/:id/image', permit('products', 'edit'), productController.removeImage)
router.delete('/products/:id', permit('products', 'delete'), productController.remove)
router.post('/products/:id/restore', permit('products', 'delete'), productController.restore)
router.delete('/products/:id/purge', permit('products', 'purge'), productController.purge)

router.get('/warehouses', warehouseController.list)
router.post('/warehouses', permit('settings', 'edit'), warehouseController.create)
router.put('/warehouses/:id', permit('settings', 'edit'), warehouseController.update)
router.delete('/warehouses/:id', permit('settings', 'edit'), warehouseController.remove)

// Valyutalar va kurslar (Sozlamalar → Valyutalar). Ro'yxat hammaga ochiq: narxlarni o'girish uchun kerak
router.get('/currencies', currencyController.list)
router.post('/currencies', permit('settings', 'edit'), currencyController.create)
router.put('/currencies/:code', permit('settings', 'edit'), currencyController.update)
router.delete('/currencies/:code', permit('settings', 'edit'), currencyController.remove)

// Investitsiya: tashqaridan kiritilgan pul (kontragentsiz, to'g'ridan-to'g'ri kassaga)
router.get('/investments', permit('investments'), investmentController.list)
router.post('/investments', permit('investments', 'create'), investmentController.create)
router.delete('/investments/:id', permit('investments', 'delete'), investmentController.remove)
router.post('/investments/:id/restore', permit('investments', 'delete'), investmentController.restore)
router.delete('/investments/:id/purge', permit('investments', 'purge'), investmentController.purge)

// Ombordan omborga ko'chirish
router.get('/transfers', permit('transfers'), transferController.list)
router.get('/transfers/:id', permit('transfers'), transferController.get)
router.post('/transfers', permit('transfers', 'create'), transferController.create)
router.delete('/transfers/:id', permit('transfers', 'delete'), transferController.remove)
router.post('/transfers/:id/restore', permit('transfers', 'delete'), transferController.restore)
router.delete('/transfers/:id/purge', permit('transfers', 'purge'), transferController.purge)

router.get('/receipts', readDoc('receipts'), receiptController.list)
router.post('/receipts', permit('receipts', 'create'), receiptController.create)
router.get('/receipts/:id', readDoc('receipts'), receiptController.get)
router.put('/receipts/:id', permit('receipts', 'edit'), receiptController.update)
router.delete('/receipts/:id', permit('receipts', 'delete'), receiptController.remove)
router.post('/receipts/:id/restore', permit('receipts', 'delete'), receiptController.restore)
router.delete('/receipts/:id/purge', permit('receipts', 'purge'), receiptController.purge)

router.get('/sales/defaults', saleController.defaults)
router.get('/sales', readSale, saleController.list)
router.get('/sales/due', permit('basket'), saleController.due)
router.get('/sales/:id', readSale, saleController.get)
router.post('/sales', permit('sales', 'create'), saleController.create)
router.put('/sales/:id/due-date', permit('basket', 'edit'), saleController.setDueDate)
// Aniq ruxsat sotuv turiga qarab controller ichida tekshiriladi (Sotuvlar yoki Savat bo'limi)
const saleDelete = permitAny(['sales-journal', 'delete'], ['basket', 'delete'])
const salePurge = permitAny(['sales-journal', 'purge'], ['basket', 'purge'])
router.delete('/sales/:id', saleDelete, saleController.remove)
router.post('/sales/:id/restore', saleDelete, saleController.restore)
router.delete('/sales/:id/purge', salePurge, saleController.purge)

router.get('/cash-desks', cashController.desks.list)
router.post('/cash-desks', permitAny(['cash', 'create'], ['cash', 'edit']), cashController.desks.create)
router.get('/cash-articles', cashController.articles.list)
router.post('/cash-articles', permitAny(['cash', 'create'], ['cash', 'edit']), cashController.articles.create)

router.get('/cash', readDoc('cash'), cashController.list)
router.get('/cash/balance', readDoc('cash'), cashController.balance)
router.get('/cash/:id', readDoc('cash'), cashController.get)
router.post('/cash', permit('cash', 'create'), cashController.create)
router.put('/cash/:id', permit('cash', 'edit'), cashController.update)
router.delete('/cash/:id', permit('cash', 'delete'), cashController.remove)
router.post('/cash/:id/restore', permit('cash', 'delete'), cashController.restore)
router.delete('/cash/:id/purge', permit('cash', 'purge'), cashController.purge)
router.get('/contractors/balances', readMoney, cashController.balances)
router.get('/contractors/:id/balance', readMoney, cashController.contractorBalance)
router.get('/contractors/:id/ledger', permitAny(['contractors'], ['reconciliation'], ['debtors']), cashController.ledger)

router.get('/payrolls', readDoc('payroll'), payrollController.list)
router.post('/payrolls', permit('payroll', 'create'), payrollController.create)
router.get('/payrolls/:id', readDoc('payroll'), payrollController.get)
router.put('/payrolls/:id', permit('payroll', 'edit'), payrollController.update)
router.delete('/payrolls/:id', permit('payroll', 'delete'), payrollController.remove)
router.post('/payrolls/:id/restore', permit('payroll', 'delete'), payrollController.restore)
router.delete('/payrolls/:id/purge', permit('payroll', 'purge'), payrollController.purge)

router.get('/sale-returns', readDoc('returns'), saleReturnController.list)
router.post('/sale-returns', permit('returns', 'create'), saleReturnController.create)
router.get('/sale-returns/:id', readDoc('returns'), saleReturnController.get)
router.put('/sale-returns/:id', permit('returns', 'edit'), saleReturnController.update)
router.delete('/sale-returns/:id', permit('returns', 'delete'), saleReturnController.remove)
router.post('/sale-returns/:id/restore', permit('returns', 'delete'), saleReturnController.restore)
router.delete('/sale-returns/:id/purge', permit('returns', 'purge'), saleReturnController.purge)

// Spisat (hisobdan chiqarish)
router.get('/writeoffs', permit('writeoffs'), writeOffController.list)
router.post('/writeoffs', permit('writeoffs', 'create'), writeOffController.create)
router.post('/writeoffs/:id/return', permit('writeoffs', 'edit'), writeOffController.returnBack)
router.delete('/writeoffs/:id', permit('writeoffs', 'delete'), writeOffController.remove)
router.post('/writeoffs/:id/restore', permit('writeoffs', 'delete'), writeOffController.restore)
router.delete('/writeoffs/:id/purge', permit('writeoffs', 'purge'), writeOffController.purge)

router.get('/reports/reconciliation', permit('reconciliation'), reportController.reconciliation)
router.get('/reports/debtors', permit('debtors'), reportController.debtors)
router.get('/reports/finance', permit('finance'), reportController.finance)
router.get('/reports/dashboard', permit('dashboard'), reportController.dashboard)
// AI yordamchi: to'liq biznes tahlili uchun barcha bo'limlar ma'lumoti (faqat Moliya hisoboti ruxsati bilan)
router.get('/reports/business-export', permit('finance'), reportController.businessExport)

// Sozlamalar: foydalanuvchilar va rollar
router.get('/users', permit('settings', 'view'), userController.list)
router.post('/users', permit('settings', 'create'), userController.create)
router.put('/users/:id', permit('settings', 'edit'), userController.update)
router.delete('/users/:id', permit('settings', 'delete'), userController.remove)

router.get('/roles', permit('settings', 'view'), roleController.list)
router.post('/roles', permit('settings', 'create'), roleController.create)
router.put('/roles/:id', permit('settings', 'edit'), roleController.update)
router.delete('/roles/:id', permit('settings', 'delete'), roleController.remove)

// Chek va printer (XP-80 / XP-58): sozlamalar - Sozlamalar bo'limi ruxsati, sotuv cheki - sotuvni ko'ra oladigan har kim
router.get('/print/settings', permit('settings', 'view'), printController.getSettings)
router.put('/print/settings', permit('settings', 'edit'), printController.saveSettings)
router.get('/print/printers', permit('settings', 'view'), printController.printers)
router.post('/print/preview', permit('settings', 'view'), printController.preview)
router.post('/print/test', permit('settings', 'edit'), printController.test)
router.post('/print/sale/:id', readSale, printController.sale)
// A4 hujjat: o'qish - sotuvni ko'ra oladiganlar va sozlamalar; saqlash - sozlamalarni o'zgartirish
router.get('/print/a4', permitAny(['sales'], ['sales-journal'], ['basket'], ['returns'], ['reconciliation'], ['debtors'], ['contractors'], ['settings']), printController.getA4)
router.put('/print/a4', permit('settings', 'edit'), printController.saveA4)

// Zakazlar (Telegram mini app'lardan). Zakaz sotuv emas: kassir uni Sotuv oynasiga olib, o'sha yerda sotadi.
router.get('/orders', permit('orders'), orderController.list)
router.get('/orders/summary', permit('orders'), orderController.summary)
router.get('/orders/mine', permitAny(['orders', 'create'], ['orders', 'view']), orderController.mine)
router.get('/orders/:id', permitAny(['orders', 'create'], ['orders', 'view']), orderController.get)
router.post('/orders', permit('orders', 'create'), orderController.create)
router.post('/orders/:id/seen', permit('orders'), orderController.seen)
router.post('/orders/:id/cancel', permit('orders', 'edit'), orderController.cancel)
router.post('/orders/:id/restore', permit('orders', 'edit'), orderController.restore)

// Telegram botlari va mini app'lar (Sozlamalar → Telegram)
router.get('/telegram/settings', permit('settings', 'view'), telegramController.get)
router.put('/telegram/settings', permit('settings', 'edit'), telegramController.save)
router.get('/telegram/status', permit('settings', 'view'), telegramController.status)

module.exports = router;
