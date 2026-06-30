// ═══════════════════════════════════════════════════════════════════
// js/sheets.js — Google Sheets API Client
//
// Talks directly to the Google Sheets REST API using a service
// account. Authentication is done by signing a JWT in the browser
// (Web Crypto API) and exchanging it for a short-lived access token.
//
// Classes:
//   GoogleAuth   → handles JWT signing + token caching
//   SheetsClient → low-level read/write helpers (get/append/put/delete)
//   SheetsAPI    → high-level domain methods (catalog/orders/customers)
//
// Usage:
//   await Sheets.init()
//   await Sheets.getCatalog(true)
//   await Sheets.saveOrder({ customer, cart, payment, notes, taxRate })
// ═══════════════════════════════════════════════════════════════════
'use strict';


/* ═══════════════════════════════════════════════════════════════════
   CLASS: GoogleAuth
   Signs a JWT with the service account's private key and exchanges
   it for an OAuth access token. Caches both the imported CryptoKey
   and the access token to avoid repeating expensive work.
═══════════════════════════════════════════════════════════════════ */
class GoogleAuth {
  constructor(serviceAccount, scope) {
    this.sa    = serviceAccount;
    this.scope = scope;
    this._key       = null;  // cached CryptoKey (imported once)
    this._token      = null; // cached access token string
    this._tokenExpMs = 0;    // when the cached token expires
  }

  /** Base64url-encode a UTF-8 string (safe for Arabic/Unicode text). */
  static toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    return GoogleAuth.bytesToBase64Url(bytes);
  }

  /** Base64url-encode raw bytes (used for the JWT signature). */
  static bytesToBase64Url(bytes) {
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /** Import the PEM private key once and cache the CryptoKey. */
  async _getCryptoKey() {
    if (this._key) return this._key;

    const pem = this.sa.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

    this._key = await crypto.subtle.importKey(
      'pkcs8', der.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );
    return this._key;
  }

  /** Build and sign a JWT assertion for the service account. */
  async _signJWT() {
    const now = Math.floor(Date.now() / 1000);
    const header  = GoogleAuth.toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = GoogleAuth.toBase64Url(JSON.stringify({
      iss:   this.sa.client_email,
      scope: this.scope,
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
    }));

    const unsigned = `${header}.${payload}`;
    const key      = await this._getCryptoKey();
    const sigBuf   = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)
    );

    return `${unsigned}.${GoogleAuth.bytesToBase64Url(new Uint8Array(sigBuf))}`;
  }

  /** Get a valid access token, refreshing if expired (with 60s buffer). */
  async getToken() {
    if (this._token && Date.now() < this._tokenExpMs - 60_000) {
      return this._token;
    }

    const jwt = await this._signJWT();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'
          + `&assertion=${jwt}`,
    });

    const data = await res.json();
    if (!data.access_token) {
      throw new Error('Auth failed: ' + (data.error_description || data.error || 'unknown error'));
    }

    this._token      = data.access_token;
    this._tokenExpMs = Date.now() + data.expires_in * 1000;
    return this._token;
  }

  /** Convenience: ready-to-use fetch headers with a fresh token. */
  async headers() {
    return {
      'Authorization': `Bearer ${await this.getToken()}`,
      'Content-Type':  'application/json',
    };
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: SheetsClient
   Low-level wrapper around the Sheets v4 REST API.
   Knows nothing about "orders" or "customers" — just rows and ranges.
═══════════════════════════════════════════════════════════════════ */
class SheetsClient {
  constructor(spreadsheetId, auth) {
    this.id   = spreadsheetId;
    this.auth = auth;
    this.base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  }

  async _request(url, options = {}) {
    const res = await fetch(url, { ...options, headers: await this.auth.headers() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `Request failed (${res.status})`);
    }
    return res.json();
  }

  /** Read all values from a sheet, optionally limited to a range like 'A1:A1'. */
  async readRange(sheetName, range = '') {
    const target = range ? `${sheetName}!${range}` : sheetName;
    const url    = `${this.base}/values/${encodeURIComponent(target)}`;
    const data   = await this._request(url);
    return data.values || [];
  }

  /** Append one or more rows to the end of a sheet. */
  async appendRows(sheetName, rows) {
    const url = `${this.base}/values/${encodeURIComponent(sheetName)}:append`
              + `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await this._request(url, { method: 'POST', body: JSON.stringify({ values: rows }) });
  }

  /** Overwrite a single cell, e.g. updateCell('Catalog', 'G5', 0). */
  async updateCell(sheetName, a1Cell, value) {
    const url = `${this.base}/values/${encodeURIComponent(sheetName + '!' + a1Cell)}`
              + `?valueInputOption=RAW`;
    await this._request(url, { method: 'PUT', body: JSON.stringify({ values: [[value]] }) });
  }

  /** Delete one row (1-based row number, including the header row). */
  async deleteRow(sheetName, rowNumber) {
    const sheetId = await this._numericSheetId(sheetName);
    const url = `${this.base}:batchUpdate`;
    await this._request(url, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
          },
        }],
      }),
    });
  }

  /** Create one or more new sheet tabs. */
  async addSheets(titles) {
    const url = `${this.base}:batchUpdate`;
    await this._request(url, {
      method: 'POST',
      body: JSON.stringify({
        requests: titles.map(title => ({ addSheet: { properties: { title } } })),
      }),
    });
  }

  /** List the titles of all existing sheet tabs. */
  async listSheetTitles() {
    const url  = `${this.base}?fields=sheets.properties.title`;
    const data = await this._request(url);
    return (data.sheets || []).map(s => s.properties.title);
  }

  /** Look up the numeric sheetId for a tab name (needed for deleteRow). */
  async _numericSheetId(sheetName) {
    const url  = `${this.base}?fields=sheets.properties`;
    const data = await this._request(url);
    const sheet = data.sheets?.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    return sheet.properties.sheetId;
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: SheetsAPI
   High-level domain API used by the rest of the app — catalog,
   customers, orders, stats. Wraps SheetsClient with the business
   logic (upserts, joins, caching, CSV export).
═══════════════════════════════════════════════════════════════════ */
class SheetsAPI {
  constructor(config) {
    this.config = config;
    this.ready  = false;

    const auth = new GoogleAuth(config.SERVICE_ACCOUNT, 'https://www.googleapis.com/auth/spreadsheets');
    this.client = new SheetsClient(config.SPREADSHEET_ID, auth);

    this.SH = config.SHEETS;
    this.HEADERS = {
      [this.SH.CATALOG]:     ['id', 'name_ar', 'name_en', 'type', 'price', 'unit', 'active'],
      [this.SH.CUSTOMERS]:   ['id', 'name', 'mobile', 'address', 'created_at'],
      [this.SH.ORDERS]:      ['id', 'customer_id', 'invoice', 'date', 'payment', 'notes',
                              'subtotal', 'tax_rate', 'tax_amount', 'total', 'created_at'],
      [this.SH.ORDER_ITEMS]: ['id', 'order_id', 'catalog_id', 'name_ar', 'name_en',
                              'price', 'quantity', 'unit', 'line_total'],
    };

    // In-memory cache — cleared per-sheet after any write
    this._cache = { catalog: null, customers: null, orders: null, items: null };
  }

  // ── Bootstrapping ────────────────────────────────────────────────

  /** Authenticate, create any missing sheet tabs, seed default catalog. */
  async init() {
    await this.client.auth.getToken();      // fail fast on bad credentials
    await this._ensureSheetsExist();
    this.ready = true;
  }

  /** Create missing tabs, write header rows, and seed the catalog. */
  async _ensureSheetsExist() {
    const existing = await this.client.listSheetTitles();
    const needed   = Object.values(this.SH);
    const missing  = needed.filter(name => !existing.includes(name));

    if (missing.length) {
      await this.client.addSheets(missing);
      await this._wait(1500); // let the API register the new tabs
    }

    for (const sheetName of needed) {
      const isEmpty = await this._isSheetEmpty(sheetName);
      if (isEmpty) await this.client.appendRows(sheetName, [this.HEADERS[sheetName]]);
    }

    const catalogRows = await this._safeReadRange(this.SH.CATALOG);
    if (catalogRows.length <= 1) {
      await this.client.appendRows(this.SH.CATALOG, this.config.DEFAULT_CATALOG);
    }
  }

  async _isSheetEmpty(sheetName) {
    const rows = await this._safeReadRange(sheetName, 'A1:A1');
    return !rows.length || !rows[0]?.length;
  }

  /** readRange that swallows errors (used for brand-new empty sheets). */
  async _safeReadRange(sheetName, range = '') {
    try { return await this.client.readRange(sheetName, range); }
    catch (_) { return []; }
  }

  _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Generic row<->object helpers ───────────────────────────────

  _rowsToObjects(rows, sheetName) {
    if (!rows || rows.length < 2) return [];
    const headers = this.HEADERS[sheetName];
    return rows.slice(1).map(row =>
      Object.fromEntries(headers.map((key, i) => [key, row[i] ?? '']))
    );
  }

  _nextId(objects) {
    if (!objects.length) return 1;
    return Math.max(...objects.map(o => parseInt(o.id) || 0)) + 1;
  }

  _timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  _invalidate(sheetName) {
    if (sheetName === this.SH.CATALOG)     this._cache.catalog   = null;
    if (sheetName === this.SH.CUSTOMERS)   this._cache.customers = null;
    if (sheetName === this.SH.ORDERS)      this._cache.orders    = null;
    if (sheetName === this.SH.ORDER_ITEMS) this._cache.items     = null;
  }

  // ── CATALOG ────────────────────────────────────────────────────

  async getCatalog(activeOnly = false) {
    if (!this._cache.catalog) {
      const rows = await this.client.readRange(this.SH.CATALOG);
      this._cache.catalog = this._rowsToObjects(rows, this.SH.CATALOG).map(item => ({
        ...item,
        id:     parseInt(item.id),
        price:  parseFloat(item.price),
        active: parseInt(item.active),
      }));
    }
    return activeOnly ? this._cache.catalog.filter(i => i.active === 1) : this._cache.catalog;
  }

  async addCatalogItem({ name_ar, name_en, type, price, unit }) {
    const all = await this.getCatalog();
    const id  = this._nextId(all);
    await this.client.appendRows(this.SH.CATALOG, [[id, name_ar, name_en, type, parseFloat(price), unit, 1]]);
    this._invalidate(this.SH.CATALOG);
    return { id, name_ar, name_en, type, price: parseFloat(price), unit, active: 1 };
  }

  async toggleCatalogItem(id) {
    const all = await this.getCatalog();
    const idx = all.findIndex(i => i.id === id);
    if (idx === -1) throw new Error('Item not found');
    await this.client.updateCell(this.SH.CATALOG, `G${idx + 2}`, all[idx].active === 1 ? 0 : 1);
    this._invalidate(this.SH.CATALOG);
  }

  async deleteCatalogItem(id) {
    const all = await this.getCatalog();
    const idx = all.findIndex(i => i.id === id);
    if (idx === -1) throw new Error('Item not found');
    await this.client.deleteRow(this.SH.CATALOG, idx + 2);
    this._invalidate(this.SH.CATALOG);
  }

  // ── ORDERS ─────────────────────────────────────────────────────

  async saveOrder({ customer, cart, payment, notes, taxRate }) {
    const customerId = await this._upsertCustomer(customer);

    const subtotal  = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total     = subtotal + taxAmount;
    const invoice   = 'FC-' + String(Date.now()).slice(-7);
    const date      = new Date().toISOString().split('T')[0];

    const orders  = await this.getAllOrders();
    const orderId = this._nextId(orders);

    await this.client.appendRows(this.SH.ORDERS, [[
      orderId, customerId, invoice, date, payment || 'Cash', notes || '',
      +subtotal.toFixed(2), taxRate, +taxAmount.toFixed(2), +total.toFixed(2), this._timestamp(),
    ]]);

    const items   = await this._getAllItems();
    let   nextId  = this._nextId(items);
    await this.client.appendRows(this.SH.ORDER_ITEMS, cart.map(item => [
      nextId++, orderId, item.catalog_id || '',
      item.name_ar, item.name_en, item.price, item.quantity, item.unit,
      +(item.price * item.quantity).toFixed(2),
    ]));

    this._invalidate(this.SH.ORDERS);
    this._invalidate(this.SH.ORDER_ITEMS);
    this._invalidate(this.SH.CUSTOMERS);

    return {
      invoice, date,
      subtotal:   +subtotal.toFixed(2),
      tax_amount: +taxAmount.toFixed(2),
      total:      +total.toFixed(2),
    };
  }

  /** Find a customer by mobile number and update them, or create a new one. */
  async _upsertCustomer({ name, mobile, address }) {
    name    = name.trim();
    mobile  = (mobile  || '').trim();
    address = (address || '').trim();

    const customers = await this.getAllCustomers();

    if (mobile) {
      const existing = customers.find(c => c.mobile === mobile);
      if (existing) {
        const id  = parseInt(existing.id);
        const row = customers.indexOf(existing) + 2;
        await this.client.updateCell(this.SH.CUSTOMERS, `B${row}`, name);
        await this.client.updateCell(this.SH.CUSTOMERS, `D${row}`, address);
        this._invalidate(this.SH.CUSTOMERS);
        return id;
      }
    }

    const id = this._nextId(customers);
    await this.client.appendRows(this.SH.CUSTOMERS, [[id, name, mobile, address, this._timestamp()]]);
    this._invalidate(this.SH.CUSTOMERS);
    return id;
  }

  async getAllOrders() {
    if (!this._cache.orders) {
      const rows = await this.client.readRange(this.SH.ORDERS);
      this._cache.orders = this._rowsToObjects(rows, this.SH.ORDERS).map(o => ({
        ...o,
        id:          parseInt(o.id),
        customer_id: parseInt(o.customer_id),
        subtotal:    parseFloat(o.subtotal),
        tax_rate:    parseFloat(o.tax_rate),
        tax_amount:  parseFloat(o.tax_amount),
        total:       parseFloat(o.total),
      }));
    }

    const customers = await this.getAllCustomers();
    const items      = await this._getAllItems();

    return [...this._cache.orders].reverse().map(order => {
      const customer = customers.find(c => parseInt(c.id) === order.customer_id) || {};
      const orderItems = items.filter(i => parseInt(i.order_id) === order.id);
      const weightKg = orderItems
        .filter(i => i.unit === 'kg')
        .reduce((sum, i) => sum + parseFloat(i.quantity), 0);

      return {
        ...order,
        customer_name: customer.name   || '—',
        mobile:        customer.mobile || '',
        total_weight:  +weightKg.toFixed(3),
      };
    });
  }

  async getOrderDetails(orderId) {
    const id     = parseInt(orderId);
    const orders = await this.getAllOrders();
    const order  = orders.find(o => o.id === id);
    if (!order) throw new Error('Order not found');

    const customers = await this.getAllCustomers();
    const customer   = customers.find(c => parseInt(c.id) === order.customer_id) || {};
    const items = (await this._getAllItems())
      .filter(i => parseInt(i.order_id) === id)
      .map(i => ({
        ...i,
        price:      parseFloat(i.price),
        quantity:   parseFloat(i.quantity),
        line_total: parseFloat(i.line_total),
      }));

    return {
      ...order,
      customer_name: customer.name    || '—',
      mobile:        customer.mobile  || '',
      address:       customer.address || '',
      items,
    };
  }

  async _getAllItems() {
    if (!this._cache.items) {
      const rows = await this.client.readRange(this.SH.ORDER_ITEMS);
      this._cache.items = this._rowsToObjects(rows, this.SH.ORDER_ITEMS);
    }
    return this._cache.items;
  }

  // ── CUSTOMERS ──────────────────────────────────────────────────

  async getAllCustomers() {
    if (!this._cache.customers) {
      const rows = await this.client.readRange(this.SH.CUSTOMERS);
      this._cache.customers = this._rowsToObjects(rows, this.SH.CUSTOMERS);
    }

    const orders = this._cache.orders || [];

    return [...this._cache.customers].reverse().map(customer => {
      const id = parseInt(customer.id);
      const customerOrders = orders.filter(o => parseInt(o.customer_id) === id);
      return {
        ...customer,
        id,
        order_count: customerOrders.length,
        total_spent: +customerOrders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0).toFixed(2),
      };
    });
  }

  // ── STATS ──────────────────────────────────────────────────────

  async getStats() {
    const [orders, customers, catalog, items] = await Promise.all([
      this.getAllOrders(),
      this.getAllCustomers(),
      this.getCatalog(true),
      this._getAllItems(),
    ]);

    return {
      total_orders:    orders.length,
      total_customers: customers.length,
      total_revenue:   +orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0).toFixed(2),
      total_kg_sold:   +items.filter(i => i.unit === 'kg')
                              .reduce((sum, i) => sum + parseFloat(i.quantity || 0), 0).toFixed(3),
      active_products: catalog.length,
    };
  }

  // ── EXPORT ─────────────────────────────────────────────────────

  /** Download Orders, Customers, and Order Items as three CSV files. */
  exportToCSV() {
    const orders    = this._cache.orders    || [];
    const customers = this._cache.customers || [];
    const items      = this._cache.items     || [];

    const toCSV = (headers, rows) => {
      const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [
        headers.map(escape).join(','),
        ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
      ].join('\n');
    };

    const download = (filename, csv) => {
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: filename });
      link.click();
      URL.revokeObjectURL(url);
    };

    download('BahrCoffee_Orders.csv', toCSV(
      ['id', 'invoice', 'date', 'customer_id', 'payment', 'notes', 'subtotal', 'tax_rate', 'tax_amount', 'total', 'created_at'],
      orders
    ));
    setTimeout(() => download('BahrCoffee_Customers.csv', toCSV(
      ['id', 'name', 'mobile', 'address', 'created_at'], customers
    )), 400);
    setTimeout(() => download('BahrCoffee_OrderItems.csv', toCSV(
      ['id', 'order_id', 'catalog_id', 'name_ar', 'name_en', 'price', 'quantity', 'unit', 'line_total'], items
    )), 800);
  }
}


// ── Single shared instance used by the rest of the app ───────────────
const Sheets = new SheetsAPI(CONFIG);
