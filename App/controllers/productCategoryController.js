const { ProductCategory, Product } = require('../../models');

// Tovar kategoriyalari (kontragent kategoriyalari bilan bir xil shaklda: total, uncategorized, categories)
exports.list = async (req, res) => {
  // O'chirishga belgilanganlar sanoqda faqat boshqaruv ro'yxatida (includeDeleted=1) hisoblanadi
  const where = req.query.includeDeleted ? {} : { deleted: false };
  const [categories, counts, total] = await Promise.all([
    ProductCategory.findAll({ order: [['name', 'ASC']] }),
    Product.count({ where, group: ['categoryId'] }),
    Product.count({ where }),
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

  if (await ProductCategory.findOne({ where: { name } })) {
    return res.status(409).json({ message: 'Bunday kategoriya mavjud' });
  }

  const category = await ProductCategory.create({ name });
  res.status(201).json({ id: category.id, name: category.name, count: 0 });
};

exports.remove = async (req, res) => {
  const category = await ProductCategory.findByPk(req.params.id);
  if (!category) return res.status(404).json({ message: 'Kategoriya topilmadi' });

  // Tovarlar o'chmaydi, faqat kategoriyasiz qoladi
  await Product.update({ categoryId: null }, { where: { categoryId: category.id } });
  await category.destroy();
  res.json({ ok: true });
};
