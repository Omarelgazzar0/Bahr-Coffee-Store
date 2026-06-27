// src/routes/customers.js — Customer Routes
// GET /api/customers  |  GET /api/customers/:id
'use strict';

const router = require('express').Router();
const db     = require('../db/database');

// GET /api/customers — all customers with order aggregates
router.get('/', (req, res) => {
  res.json(db.all(`
    SELECT c.id, c.name, c.mobile, c.address, c.created_at,
           COUNT(o.id)               AS order_count,
           COALESCE(SUM(o.total), 0) AS total_spent
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id ORDER BY c.id DESC
  `));
});

// GET /api/customers/:id — single customer + their orders
router.get('/:id', (req, res) => {
  const id  = parseInt(req.params.id);
  const row = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: 'Customer not found' });

  row.orders = db.all(`
    SELECT o.id, o.invoice, o.date, o.payment, o.total, o.created_at,
           COALESCE(SUM(CASE WHEN oi.unit = 'kg' THEN oi.quantity ELSE 0 END), 0) AS total_weight
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = ?
    GROUP BY o.id ORDER BY o.id DESC
  `, [id]);

  res.json(row);
});

module.exports = router;
