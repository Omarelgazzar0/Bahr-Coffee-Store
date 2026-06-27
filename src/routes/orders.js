// src/routes/orders.js — Order Routes
// POST /api/orders  |  GET /api/orders  |  GET /api/orders/:id
'use strict';

const router = require('express').Router();
const db     = require('../db/database');

// POST /api/orders — create full order atomically
router.post('/', (req, res) => {
  const { customer, cart, payment, notes, tax_rate } = req.body;

  if (!customer?.name?.trim())          return res.status(400).json({ error: 'Customer name is required' });
  if (!Array.isArray(cart) || !cart.length) return res.status(400).json({ error: 'Cart is empty' });

  const taxRate  = parseFloat(tax_rate) || 14;
  const subtotal = cart.reduce((s, i) => s + parseFloat(i.price) * parseFloat(i.quantity), 0);
  const taxAmt   = subtotal * (taxRate / 100);
  const total    = subtotal + taxAmt;
  const invoice  = 'FC-' + String(Date.now()).slice(-7);
  const date     = new Date().toISOString().split('T')[0];

  const custName   = customer.name.trim();
  const custMobile = (customer.mobile  || '').trim();
  const custAddr   = (customer.address || '').trim();

  try {
    const result = db.transaction(tx => {
      // Upsert customer
      let customerId;
      if (custMobile) {
        const existing = tx.get('SELECT id FROM customers WHERE mobile = ? LIMIT 1', [custMobile]);
        if (existing) {
          tx.run('UPDATE customers SET name=?, address=? WHERE id=?', [custName, custAddr, existing.id]);
          customerId = existing.id;
        }
      }
      if (!customerId) {
        customerId = tx.run(
          'INSERT INTO customers (name, mobile, address) VALUES (?,?,?)',
          [custName, custMobile, custAddr]
        ).lastInsertRowid;
      }

      // Insert order header
      const orderId = tx.run(
        `INSERT INTO orders (customer_id,invoice,date,payment,notes,subtotal,tax_rate,tax_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [customerId, invoice, date, payment || 'Cash', notes || '',
         subtotal, taxRate, taxAmt, total]
      ).lastInsertRowid;

      // Insert line items
      cart.forEach(item => {
        const qty = parseFloat(item.quantity), price = parseFloat(item.price);
        tx.run(
          `INSERT INTO order_items (order_id,catalog_id,name_ar,name_en,price,quantity,unit,line_total)
           VALUES (?,?,?,?,?,?,?,?)`,
          [orderId, item.catalog_id || null, item.name_ar, item.name_en, price, qty, item.unit, price * qty]
        );
      });

      return { orderId, customerId };
    });

    res.status(201).json({
      order_id: result.orderId, customer_id: result.customerId,
      invoice, date,
      subtotal:   +subtotal.toFixed(2),
      tax_amount: +taxAmt.toFixed(2),
      total:      +total.toFixed(2),
    });

  } catch (err) {
    console.error('[Orders]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders — order history
router.get('/', (req, res) => {
  res.json(db.all(`
    SELECT o.id, o.invoice, o.date, c.name AS customer_name, c.mobile,
           o.payment, o.subtotal, o.tax_rate, o.tax_amount, o.total,
           o.notes, o.created_at,
           COALESCE(SUM(CASE WHEN oi.unit = 'kg' THEN oi.quantity ELSE 0 END), 0) AS total_weight
    FROM orders o
    JOIN customers   c  ON c.id = o.customer_id
    JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id ORDER BY o.id DESC
  `));
});

// GET /api/orders/:id — single order + items
router.get('/:id', (req, res) => {
  const id    = parseInt(req.params.id);
  const order = db.get(`
    SELECT o.*, c.name AS customer_name, c.mobile, c.address
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?`, [id]);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.items = db.all('SELECT * FROM order_items WHERE order_id = ?', [id]);
  res.json(order);
});

module.exports = router;
