'use strict';

/**
 * Server xabarlarining rus tarjimasi. Kalit - kodda yozilgan o'zbekcha xabar.
 * Yangi xabar qo'shsangiz, shu yerga ham ruscha variantini yozing
 * (topilmasa o'zbekcha xabar qaytariladi).
 */
const exact = {
  'Login va parol kiritilishi shart': 'Введите логин и пароль',
  "Login yoki parol noto'g'ri": 'Неверный логин или пароль',
  'Ism, login va parol kiritilishi shart': 'Введите имя, логин и пароль',
  'Bu login band': 'Этот логин уже занят',
  'Avtorizatsiya talab qilinadi': 'Требуется авторизация',
  'Token yaroqsiz yoki muddati tugagan': 'Токен недействителен или срок его действия истёк',
  'Topilmadi': 'Не найдено',
  'Server xatosi': 'Ошибка сервера',

  "Hujjat turi noto'g'ri": 'Неверный вид документа',
  'Hujjat topilmadi': 'Документ не найден',
  'Summani kiriting': 'Введите сумму',
  'Ikkala kontragentni tanlang': 'Выберите обоих контрагентов',
  "Kontragentlar bir xil bo'lishi mumkin emas": 'Контрагенты не могут совпадать',
  'Kassani tanlang': 'Выберите кассу',
  'Kontragentni tanlang': 'Выберите контрагента',
  'Nomini kiriting': 'Введите название',
  'Bunday nom mavjud': 'Такое название уже существует',

  'Kategoriya nomini kiriting': 'Введите название категории',
  'Bunday kategoriya mavjud': 'Такая категория уже существует',
  'Kategoriya topilmadi': 'Категория не найдена',

  'Kontragent nomini kiriting': 'Введите наименование контрагента',
  'Kontragent topilmadi': 'Контрагент не найден',
  "Kontragent hujjatlarda ishlatilgan, o'chirib bo'lmaydi": 'Контрагент используется в документах, удалить нельзя',
  'Kontragentlarni belgilang': 'Отметьте контрагентов',

  'Tovar nomini kiriting': 'Введите наименование товара',
  'Tovar topilmadi': 'Товар не найден',
  "Tovar hujjatlarda ishlatilgan, o'chirib bo'lmaydi": 'Товар используется в документах, удалить нельзя',

  'Omborni tanlang': 'Выберите склад',
  'Sotuv hujjatini tanlang': 'Выберите документ продажи',
  'Sotuv topilmadi': 'Продажа не найдена',
  'Qaytariladigan tovarlarni qoldiring': 'Оставьте товары для возврата',
  'Tovar bu sotuvga tegishli emas': 'Товар не относится к этой продаже',
  "Qaytariladigan pul jami summadan oshib ketdi": 'Возвращаемые деньги превышают сумму возврата',
  "Oddiy mijozga qaytarishda pul to'liq qaytarilishi kerak": 'Обычному клиенту деньги нужно вернуть полностью',
  "To'lov summasi manfiy bo'lishi mumkin emas": 'Сумма оплаты не может быть отрицательной',
  "To'lov uchun kassani tanlang": 'Выберите кассу для оплаты',
  "To'lov summasi jami summadan oshib ketdi": 'Сумма оплаты превышает итоговую сумму',
  'Qarzga sotish (savat) uchun mijozni (kontragentni) tanlang': 'Для продажи в долг (корзина) выберите клиента (контрагента)',
  'Barcha qatorlarda xodim tanlanishi kerak': 'Во всех строках должен быть выбран сотрудник',
  "Summa 0 dan katta bo'lishi kerak": 'Сумма должна быть больше 0',
  "Xodimlarni qo'shing": 'Добавьте сотрудников',
  "Tovar qo'shing": 'Добавьте товар',
  'Barcha qatorlarda tovar tanlanishi kerak': 'Во всех строках должен быть выбран товар',
  "Soni 0 dan katta bo'lishi kerak": 'Количество должно быть больше 0',
  "Narx manfiy bo'lishi mumkin emas": 'Цена не может быть отрицательной',

  "Bu amal uchun ruxsat yo'q": 'Нет прав для этого действия',
  "O'chirilgan hujjatni o'zgartirib bo'lmaydi. Avval o'chirish belgisini bekor qiling": 'Удаленный документ изменить нельзя. Сначала снимите пометку удаления',
  "Oddiy mijozni o'chirib bo'lmaydi": 'Обычного клиента удалить нельзя',
  'Tovarni tanlang': 'Выберите товар',
  'Faylni tanlang': 'Выберите файл',
  'Printer tanlanmagan': 'Принтер не выбран',
  "Printer sozlanmagan: Sozlamalar → Chek va printer bo'limida printerni tanlang": 'Принтер не настроен: выберите принтер в разделе «Настройки → Чек и принтер»',
  "Faylni o'qib bo'lmadi. Excel (.xlsx) faylini tanlang": 'Не удалось прочитать файл. Выберите файл Excel (.xlsx)',
  "Faylda varaq yo'q": 'В файле нет листов',
  'Sarlavha topilmadi: birinchi qatorda "Название" (yoki "Nomi") ustuni bo\'lishi kerak': 'Не найден заголовок: в первой строке должна быть колонка «Название»',
  "Faylda tovar qatorlari yo'q": 'В файле нет строк с товарами',
  'Faylda xatolar bor. Avval ularni tuzating': 'В файле есть ошибки. Сначала исправьте их',
  "Tovar nomi bo'sh": 'Пустое название товара',
  "Qaytarish sanasi sotuv sanasidan oldin bo'lishi mumkin emas": 'Дата возврата не может быть раньше даты продажи',
  "Summa manfiy bo'lishi mumkin emas": 'Сумма не может быть отрицательной',
  "O'zingizda yo'q ruxsatni bera olmaysiz": 'Нельзя выдавать права, которых нет у вас самих',
  "Oddiy mijozni qora ro'yxatga qo'shib bo'lmaydi": 'Обычного клиента нельзя добавить в черный список',
  "Qora ro'yxat kategoriyasini o'chirib bo'lmaydi": 'Категорию «Черный список» удалить нельзя',
  'Bu foydalanuvchi bloklangan': 'Этот пользователь заблокирован',
  "Ro'yxatdan o'tish yopiq. Yangi foydalanuvchini Sozlamalar oynasida qo'shing": 'Регистрация закрыта. Добавьте нового пользователя в окне «Настройки»',
  'Tovarlarni belgilang': 'Отметьте товары',
  "Kontragentga tizim logini berilgan, avval Sozlamalarda o'chiring": 'Контрагенту выдан логин в системе, сначала удалите его в «Настройках»',

  'Rol nomini kiriting': 'Введите название роли',
  'Bunday rol mavjud': 'Такая роль уже существует',
  'Rol topilmadi': 'Роль не найдена',
  "Rol foydalanuvchilarga biriktirilgan, o'chirib bo'lmaydi": 'Роль назначена пользователям, удалить нельзя',
  'Rolni tanlang': 'Выберите роль',
  'Foydalanuvchi topilmadi': 'Пользователь не найден',
  'Xodimni (kontragentni) tanlang': 'Выберите сотрудника (контрагента)',
  'Bu kontragentga login allaqachon berilgan': 'Этому контрагенту логин уже выдан',
  'Login kiritilishi shart': 'Введите логин',
  'Parolni kiriting': 'Введите пароль',
  "Administratorni faqat administrator o'zgartira oladi": 'Администратора может изменять только администратор',
  "O'z rolingizni o'zgartira olmaysiz": 'Нельзя изменить собственную роль',
  "O'zingizni bloklay olmaysiz": 'Нельзя заблокировать самого себя',
  "O'zingizni o'chira olmaysiz": 'Нельзя удалить самого себя',

  // Telegram mini app'lar va zakazlar
  "Ko'rib chiqilmoqda": "На рассмотрении",
  "Bajarildi": "Выполнен",
  "Internet magazin hozircha yopiq": "Интернет-магазин временно закрыт",
  "Do'konni Telegram bot orqali oching": "Откройте магазин через Telegram-бота",
  "Juda ko'p zakaz. Birozdan keyin urinib ko'ring": "Слишком много заказов. Попробуйте позже",
  "Telefon raqamini kiriting": "Введите номер телефона",
  "Xodimlar mini app'i o'chirilgan": "Mini app для сотрудников отключён",
  "Mini app'ni Telegram bot orqali oching": "Откройте mini app через Telegram-бота",
  "Zakaz topilmadi": "Заказ не найден",
  "Sotilgan zakazni bekor qilib bo'lmaydi": "Проданный заказ нельзя отменить",
  "Bot tokeni noto'g'ri. BotFather bergan tokenni to'liq kiriting": "Неверный токен бота. Введите полный токен от BotFather",
  "Botni yoqish uchun tokenni kiriting": "Чтобы включить бота, введите токен",
  "Mijozlar va xodimlar uchun alohida bot kerak (tokenlar bir xil)": "Для клиентов и сотрудников нужны разные боты (токены совпадают)",
  "Mini app uchun HTTPS manzil kiriting (masalan https://dokon.uz)": "Укажите HTTPS-адрес для mini app (например https://dokon.uz)",
  "Rasm formati noto'g'ri (JPG, PNG yoki WEBP)": "Неверный формат изображения (JPG, PNG или WEBP)",
  "Rasm bo'sh": "Изображение пустое",
  "Rasm hajmi 5 MB dan oshmasin": "Размер изображения не более 5 МБ",
  "Mijoz topilmadi": "Клиент не найден",
  "Ismni kiriting": "Введите имя",
  "Manzilni kiriting": "Введите адрес",
};

// O'zgaruvchan qismli xabarlar (tartib muhim: aniqrog'i avval)
const patterns = [
  [/^Chek chiqmadi: (.*)$/, 'Чек не напечатан: $1'],
  [/^Noto'g'ri son: (.*)$/, 'Неверное число: $1'],
  [/^Qarz limiti oshib ketdi: (.*) \(limit: (.*), qarz bo'ladi: (.*)\)$/, 'Превышен лимит долга: $1 (лимит: $2, долг станет: $3)'],
  [/^Bu to'lov (.*) kirim hujjatidan avtomatik yaratilgan\. Uni kirim hujjatida o'zgartiring$/, 'Эта оплата создана автоматически из документа поступления $1. Изменяйте ее в документе поступления'],
  [/^Tovar o'chirilgan: (.*)$/, 'Товар удален: $1'],
  [/^Mijoz o'chirilgan: (.*)$/, 'Клиент удален: $1'],
  [/^Qaytariladigan son spisatdagi sondan oshib ketdi \(qolgan: (.*)\)$/, 'Возвращаемое количество превышает списанное (осталось: $1)'],
  [/^Qora ro'yxatdagi mijozga tovar sotib bo'lmaydi: (.*)$/, 'Клиенту из черного списка товар продавать нельзя: $1'],
  [/^Kassada mablag' yetarli emas: "(.*)" kassasida (.*) (\S+) yetishmaydi$/, 'Недостаточно средств в кассе «$1»: не хватает $2 $3'],
  [/^Diller narxidan arzon sotish mumkin emas: (.*) \(diller narxi: (.*)\)$/, 'Нельзя продавать дешевле дилерской цены: $1 (дилерская цена: $2)'],
  [/^Ustama\/chegirma bilan jami summa diller narxidan past bo'lishi mumkin emas \(minimum: (.*)\)$/, 'Итоговая сумма с наценкой/скидкой не может быть ниже дилерской (минимум: $1)'],
  [/^Qaytarish soni sotilgan sondan oshib ketdi: (.*)$/, 'Количество возврата превышает проданное: $1'],
  [/^Qoldiq yetarli emas: (.*) \(bor: (.*)\)$/, 'Недостаточно остатка: $1 (есть: $2)'],
  [/^Qoldiq yetarli emas: (.*)$/, 'Недостаточно остатка: $1'],
];

function translate(message) {
  if (exact[message]) return exact[message];
  for (const [re, replacement] of patterns) {
    if (re.test(message)) return message.replace(re, replacement);
  }
  return message;
}

module.exports = { translate };
