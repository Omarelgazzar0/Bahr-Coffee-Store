// ═══════════════════════════════════════════════════════════════════
// server.js — Fares Mansour Coffee POS  |  Express Entry Point
//
// Run:  npm start          (production)
//       npm run dev        (auto-restart on changes)
// Open: http://localhost:3000
// ═══════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const db      = require('./src/db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────
app.use('/api/catalog',   require('./src/routes/catalog'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/orders',    require('./src/routes/orders'));
app.use('/api/stats',     require('./src/routes/stats'));

// ── Serve SPA for all non-API routes ─────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────
async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log('\n☕  Fares Mansour Coffee POS');
    console.log('   ─────────────────────────────');
    console.log(`   http://localhost:${PORT}`);
    console.log('   Database → data/fares_mansour.db');
    console.log('   Ctrl+C to stop\n');
  });
}

start().catch(err => { console.error('[Startup]', err); process.exit(1); });
