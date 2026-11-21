'use strict';

/**
 * Qora ro'yxat: yomon yoki juda katta qarzi bor kontragentga tovar sotilmaydi.
 * "Qora ro'yxat" kategoriyasi shu ro'yxatni ko'rsatib turadi: kontragent qora ro'yxatga qo'shilsa
 * kategoriyaga o'zi tushadi, chiqarilsa o'zi chiqadi (va aksincha: kategoriyaga biriktirilsa ro'yxatga tushadi).
 */

const { Category, Contractor } = require('../../models');

const BLACKLIST_CATEGORY = "Qora ro'yxat";
const RETAIL_CLIENT = 'Chakana mijoz';

/** Kategoriya yo'q bo'lsa yaratadi */
async function ensureCategory() {
  const [category] = await Category.findOrCreate({ where: { name: BLACKLIST_CATEGORY } });
  return category;
}

/**
 * Kontragent ma'lumotiga (create/update) qora ro'yxat qoidasini qo'llaydi:
 *  - blacklisted belgilansa -> kategoriya "Qora ro'yxat";
 *  - belgi olinsa va kategoriya "Qora ro'yxat" bo'lsa -> kategoriyasiz;
 *  - faqat kategoriya o'zgarsa -> "Qora ro'yxat" ga biriktirilsa ro'yxatga tushadi, undan chiqarilsa chiqadi.
 * `current` - mavjud kontragent (yangi bo'lsa null).
 */
async function apply(data, current) {
  if (!('blacklisted' in data) && !('categoryId' in data)) return data;
  const cat = await ensureCategory();

  if ('blacklisted' in data) {
    data.blacklisted = !!data.blacklisted;
    if (data.blacklisted) data.categoryId = cat.id;
    else if (('categoryId' in data ? data.categoryId : current && current.categoryId) === cat.id) data.categoryId = null;
  } else if (data.categoryId === cat.id) {
    data.blacklisted = true;
  } else if (current && current.categoryId === cat.id) {
    data.blacklisted = false;
  }
  return data;
}

/** Belgilangan kontragentlarni qora ro'yxatga qo'shadi yoki chiqaradi */
async function setMany(ids, value) {
  const cat = await ensureCategory();
  if (value) {
    const [count] = await Contractor.update({ blacklisted: true, categoryId: cat.id }, { where: { id: ids } });
    return count;
  }
  await Contractor.update({ categoryId: null }, { where: { id: ids, categoryId: cat.id } });
  const [count] = await Contractor.update({ blacklisted: false }, { where: { id: ids } });
  return count;
}

module.exports = { BLACKLIST_CATEGORY, RETAIL_CLIENT, ensureCategory, apply, setMany };
