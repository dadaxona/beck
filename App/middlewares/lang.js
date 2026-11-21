'use strict';

const { translate } = require('../i18n/ru');

// So'rovdagi "X-Lang: ru" sarlavhasi bo'yicha xato xabarlarini ruscha qaytaradi (standart: o'zbekcha)
module.exports = (req, res, next) => {
  if (String(req.headers['x-lang'] || '').toLowerCase() === 'ru') {
    const json = res.json.bind(res);
    res.json = (body) =>
      json(body && typeof body === 'object' && typeof body.message === 'string'
        ? { ...body, message: translate(body.message) }
        : body);
  }
  next();
};
