const { Warehouse } = require('../../models');

exports.list = async (req, res) => {
  res.json(await Warehouse.findAll({ order: [['id', 'ASC']] }));
};
