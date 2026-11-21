const { Category, Contractor } = require('../../models');
const { BLACKLIST_CATEGORY } = require('../services/blacklist');

exports.list = async (req, res) => {
  // O'chirishga belgilanganlar sanoqda faqat boshqaruv ro'yxatida (includeDeleted=1) hisoblanadi
  const where = req.query.includeDeleted ? {} : { deleted: false };
  const [categories, counts, total] = await Promise.all([
    Category.findAll({ order: [['name', 'ASC']] }),
    Contractor.count({ where, group: ['categoryId'] }),
    Contractor.count({ where }),
  ]);

  const countOf = (id) => counts.find((c) => c.categoryId === id)?.count || 0;

  res.json({
    total,
    uncategorized: countOf(null),
    categories: categories.map((c) => ({ id: c.id, name: c.name, count: countOf(c.id) })),
  });
};

exports.create = async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Kategoriya nomini kiriting' });

  if (await Category.findOne({ where: { name } })) {
    return res.status(409).json({ message: 'Bunday kategoriya mavjud' });
  }

  const category = await Category.create({ name });
  res.status(201).json({ id: category.id, name: category.name, count: 0 });
};

exports.remove = async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return res.status(404).json({ message: 'Kategoriya topilmadi' });

  if (category.name === BLACKLIST_CATEGORY) {
    return res.status(409).json({ message: "Qora ro'yxat kategoriyasini o'chirib bo'lmaydi" });
  }

  // Kontragentlar o'chmaydi, faqat kategoriyasiz qoladi
  await Contractor.update({ categoryId: null }, { where: { categoryId: category.id } });
  await category.destroy();
  res.json({ ok: true });
};
