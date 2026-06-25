// ═══════════════════════════════════════════════════════════════════
// src/db/database.js — SQLite Database Layer (sql.js)
//
// sql.js = pure-JS SQLite compiled via Emscripten.
// Zero native dependencies — works on any platform without build tools.
//
// Persistence: database is kept in memory as a Uint8Array and written
// to disk after every write operation.
//
// DB path resolution (in order):
//   1. DB_PATH env variable  → set this on Render to a persistent disk path
//   2. ./data/bahr_coffee.db → default for local development
// ═══════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');

// On Render: set DB_PATH=/var/data/bahr_coffee.db (persistent disk mount)
// Locally:   falls back to ./data/bahr_coffee.db
const DB_FILE = process.env.DB_PATH
  || path.join(__dirname, '../../data', 'bahr_coffee.db');
const DB_DIR  = path.dirname(DB_FILE);

let _db  = null;
let _SQL = null;
let _inTransaction = false;  // when true, run() skips _persist() (transaction handles it)

// ── Write in-memory database to disk ─────────────────────────────
function _persist() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
}

// ── Convert sql.js exec() results → array of plain objects ───────
function _toObjects(result) {
  if (!result || result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

// ── Create all tables (safe to run on every startup) ─────────────
function _createSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar    TEXT    NOT NULL,
      name_en    TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'coffee',
      price      REAL    NOT NULL DEFAULT 0,
      unit       TEXT    NOT NULL DEFAULT 'kg',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    DEFAULT (datetime('now'))
    )`);

  _db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      mobile     TEXT,
      address    TEXT,
      created_at TEXT    DEFAULT (datetime('now'))
    )`);

  _db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id),
      invoice     TEXT    NOT NULL,
      date        TEXT    NOT NULL,
      payment     TEXT    NOT NULL DEFAULT 'Cash',
      notes       TEXT,
      subtotal    REAL    NOT NULL DEFAULT 0,
      tax_rate    REAL    NOT NULL DEFAULT 14,
      tax_amount  REAL    NOT NULL DEFAULT 0,
      total       REAL    NOT NULL DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now'))
    )`);

  _db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER REFERENCES orders(id),
      catalog_id INTEGER REFERENCES catalog_items(id),
      name_ar    TEXT    NOT NULL,
      name_en    TEXT    NOT NULL,
      price      REAL    NOT NULL,
      quantity   REAL    NOT NULL,
      unit       TEXT    NOT NULL,
      line_total REAL    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    )`);

  _db.run('PRAGMA foreign_keys = ON');
}

// ── Seed default catalog items on first run ───────────────────────
function _seed() {
  const count = _db.exec('SELECT COUNT(*) AS n FROM catalog_items')[0].values[0][0];
  if (count > 0) return;

  const items = [
    ['حبشي هرهري',     'Ethiopian Harari',   'coffee',     440, 'kg'],
    ['برازيلي سانتوس', 'Brazilian Santos',   'coffee',     580, 'kg'],
    ['إندونيسي',       'Indonesian',         'coffee',     300, 'kg'],
    ['هندي أرابيكا',   'Indian Arabica',     'coffee',     700, 'kg'],
    ['باكيت ٢٥٠ جم',   '250g Pack',          'package',     15, 'piece'],
    ['باكيت ٥٠٠ جم',   '500g Pack',          'package',     25, 'piece'],
    ['سكر',            'Sugar',              'ingredient',  30, 'kg'],
    ['هيل',            'Cardamom',           'ingredient', 250, 'kg'],
  ];

  items.forEach(r => _db.run(
    'INSERT INTO catalog_items (name_ar, name_en, type, price, unit) VALUES (?,?,?,?,?)', r
  ));
  console.log(`[DB] Seeded ${items.length} default catalog items.`);
}

// ── Public API ────────────────────────────────────────────────────
module.exports = {

  async init() {
    const initSqlJs = require('sql.js');
    _SQL = await initSqlJs();
    fs.mkdirSync(DB_DIR, { recursive: true });

    if (fs.existsSync(DB_FILE)) {
      _db = new _SQL.Database(fs.readFileSync(DB_FILE));
      console.log('[DB] Loaded:', DB_FILE);
    } else {
      _db = new _SQL.Database();
      console.log('[DB] Created:', DB_FILE);
    }

    _createSchema();
    _seed();
    _persist();
    console.log('[DB] Ready.');
  },

  // SELECT → array of objects
  all(sql, params = []) {
    return _toObjects(_db.exec(sql, params));
  },

  // SELECT → first row object or null
  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows[0] ?? null;
  },

  // INSERT / UPDATE / DELETE → { lastInsertRowid, changes }
  run(sql, params = []) {
    _db.run(sql, params);
    const meta = _db.exec('SELECT last_insert_rowid() AS id, changes() AS ch')[0].values[0];
    // Skip disk write inside transactions — transaction() persists once at COMMIT
    if (!_inTransaction) _persist();
    return { lastInsertRowid: meta[0], changes: meta[1] };
  },

  // Wrap multiple run() calls in one atomic transaction.
  // Uses a _inTransaction flag to suppress individual _persist() calls
  // inside the transaction — we persist once at COMMIT instead.
  transaction(fn) {
    _inTransaction = true;
    _db.run('BEGIN');
    try {
      const result = fn(this);
      _db.run('COMMIT');
      _inTransaction = false;
      _persist();     // single write to disk for the whole batch
      return result;
    } catch (err) {
      _db.run('ROLLBACK');
      _inTransaction = false;
      throw err;
    }
  },
};
