'use strict';

const { has } = require('../../config/permissions');

const DENIED = "Bu amal uchun ruxsat yo'q";

/** permit('products', 'create') - shu bo'limda shu amalga ruxsat bo'lsa o'tkazadi, aks holda 403 */
const permit = (section, action = 'view') => (req, res, next) =>
  has(req.user && req.user.permissions, section, action) ? next() : res.status(403).json({ message: DENIED });

/**
 * permitAny(['cash', 'view'], ['reconciliation', 'view']) - ro'yxatdagi juftliklardan kamida bittasiga ruxsat bo'lsa.
 * Bir hujjat bir necha bo'limdan ochilishi mumkin (masalan, akt sverkadagi qatordan kassa hujjati).
 */
const permitAny = (...pairs) => (req, res, next) =>
  pairs.some(([section, action = 'view']) => has(req.user && req.user.permissions, section, action))
    ? next()
    : res.status(403).json({ message: DENIED });

module.exports = { permit, permitAny };
