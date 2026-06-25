// src/routes/stats.js — Dashboard Stats
// GET /api/stats
'use strict';

const router = require('express').Router();
const db     = require('../db/database');

router.get('/', (req, res) => {
  res.json(db.get(`
    SELECT
      (SELECT COUNT(*)                  FROM orders)                         AS total_orders,
      (SELECT COUNT(*)                  FROM customers)                      AS total_customers,
      (SELECT COALESCE(SUM(total), 0)   FROM orders)                         AS total_revenue,
      (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE unit = 'kg')  AS total_kg_sold,
      (SELECT COUNT(*)                  FROM catalog_items WHERE active = 1) AS active_products
  `));
});

module.exports = router;
