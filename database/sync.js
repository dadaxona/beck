'use strict';

/**
 * Bazani modellarga moslaydi (migratsiyasiz):
 *  1) yo'q jadvallarni yaratadi (sync);
 *  2) jadvalda bor-u, bazada yo'q ustunlarni qo'shadi.
 * Faqat qo'shadi: mavjud ustun, jadval va ma'lumotlarga tegmaydi.
 * (sync({ alter: true }) SQLite da mavjud ma'lumot bilan FOREIGN KEY xatosi beradi.)
 */
async function syncSchema(sequelize) {
  await sequelize.sync();

  const qi = sequelize.getQueryInterface();

  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const existing = await qi.describeTable(table);

    for (const [name, attribute] of Object.entries(model.getAttributes())) {
      const column = attribute.field || name;
      if (column in existing) continue;

      await qi.addColumn(table, column, attribute);
      console.log(`Ustun qo'shildi: ${typeof table === 'string' ? table : table.tableName}.${column}`);
    }
  }
}

module.exports = { syncSchema };
