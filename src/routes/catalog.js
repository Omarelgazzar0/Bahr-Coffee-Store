// src/routes/catalog.js — Catalog CRUD
// GET /api/catalog  |  POST /api/catalog
// PATCH /api/catalog/:id/toggle  |  DELETE /api/catalog/:id
'use strict';

const router = require('express').Router();
const db     = require('../db/database');

// GET /api/catalog  (?active=true for POS grid)
router.get('/', (req, res) => {
  const sql = req.query.active === 'true'
    ? 'SELECT * FROM catalog_items WHERE active = 1 ORDER BY type, id'
    : 'SELECT * FROM catalog_items ORDER BY type, id';
  res.json(db.all(sql));
});

// POST /api/catalog
router.post('/', (req, res) => {
  const { name_ar, name_en, type, price, unit } = req.body;

  if (!name_ar?.trim()) return res.status(400).json({ error: 'name_ar is required' });
  if (!name_en?.trim()) return res.status(400).json({ error: 'name_en is required' });
  if (!['coffee','package','ingredient'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });
  if (!['kg','g','piece','pack'].includes(unit))
    return res.status(400).json({ error: 'Invalid unit' });

  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0)
    return res.status(400).json({ error: 'Price must be a non-negative number' });

  const { lastInsertRowid } = db.run(
    'INSERT INTO catalog_items (name_ar, name_en, type, price, unit) VALUES (?,?,?,?,?)',
    [name_ar.trim(), name_en.trim(), type, parsedPrice, unit]
  );
  res.status(201).json(db.get('SELECT * FROM catalog_items WHERE id = ?', [lastInsertRowid]));
});

// PATCH /api/catalog/:id/toggle
router.patch('/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.get('SELECT id FROM catalog_items WHERE id = ?', [id]))
    return res.status(404).json({ error: 'Item not found' });

  db.run('UPDATE catalog_items SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=?', [id]);
  res.json(db.get('SELECT * FROM catalog_items WHERE id = ?', [id]));
});

// DELETE /api/catalog/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.get('SELECT id FROM catalog_items WHERE id = ?', [id]))
    return res.status(404).json({ error: 'Item not found' });

  const used = db.get('SELECT COUNT(*) AS n FROM order_items WHERE catalog_id = ?', [id]).n;
  if (used > 0) {
    db.run('UPDATE catalog_items SET active = 0 WHERE id = ?', [id]);
    return res.json({ message: 'Archived (has order history)', archived: true });
  }
  db.run('DELETE FROM catalog_items WHERE id = ?', [id]);
  res.json({ message: 'Deleted', deleted: true });
});

module.exports = router;
