// ═══════════════════════════════════════════════════════════════════
// js/sheets.js — Google Sheets API Client (Service Account JWT auth)
//
// Uses the service account private key to sign JWTs in the browser,
// exchanges them for access tokens, then calls the Sheets REST API.
// No user login required — works silently in the background.
//
// Public API:
//   await Sheets.init()                 → authenticate & set up sheets
//   Sheets.ready                        → true once authenticated
//   await Sheets.getCatalog(activeOnly) → array of catalog items
//   await Sheets.addCatalogItem(item)   → append row
//   await Sheets.toggleCatalogItem(id) → flip active flag
//   await Sheets.deleteCatalogItem(id) → delete row
//   await Sheets.saveOrder({...})       → write customer+order+items
//   await Sheets.getAllOrders()         → array with customer name & weight
//   await Sheets.getOrderDetails(id)   → order + items
//   await Sheets.getAllCustomers()      → array with aggregates
//   await Sheets.getStats()            → dashboard totals
// ═══════════════════════════════════════════════════════════════════
'use strict';

const Sheets = (() => {

  let _token     = null;   // current OAuth access token string
  let _tokenExp  = 0;      // expiry timestamp (ms)

  // In-memory cache — cleared after each write
  const _cache = { catalog: null, customers: null, orders: null, items: null };

  const SID = CONFIG.SPREADSHEET_ID;
  const SA  = CONFIG.SERVICE_ACCOUNT;
  const SH  = CONFIG.SHEETS;

  // Column headers for each sheet
  const HEADERS = {
    [SH.CATALOG]:     ['id','name_ar','name_en','type','price','unit','active'],
    [SH.CUSTOMERS]:   ['id','name','mobile','address','created_at'],
    [SH.ORDERS]:      ['id','customer_id','invoice','date','payment','notes',
                       'subtotal','tax_rate','tax_amount','total','created_at'],
    [SH.ORDER_ITEMS]: ['id','order_id','catalog_id','name_ar','name_en',
                       'price','quantity','unit','line_total'],
  };

  // ── JWT helpers ─────────────────────────────────────────────────

  function _b64url(str) {
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  }

  function _b64urlUint8(bytes) {
    let s = '';
    bytes.forEach(b => s += String.fromCharCode(b));
    return _b64url(s);
  }

  // Import the PEM private key for signing
  async function _importKey() {
    const pem = SA.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'pkcs8', der.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );
  }

  // Create and sign a JWT, then exchange it for an access token
  async function _getToken() {
    // Return cached token if still valid (with 60s buffer)
    if (_token && Date.now() < _tokenExp - 60000) return _token;

    const now = Math.floor(Date.now() / 1000);
    const header  = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss:   SA.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
    };

    const hdr = _b64url(JSON.stringify(header));
    const pld = _b64url(JSON.stringify(payload));
    const msg = `${hdr}.${pld}`;

    const key  = await _importKey();
    const sig  = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', key,
      new TextEncoder().encode(msg)
    );

    const jwt = `${msg}.${_b64urlUint8(new Uint8Array(sig))}`;

    // Exchange JWT for access token
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    const data = await res.json();
    if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));

    _token    = data.access_token;
    _tokenExp = Date.now() + (data.expires_in * 1000);
    return _token;
  }

  // ── HTTP helpers ─────────────────────────────────────────────────

  async function _headers() {
    return {
      'Authorization': `Bearer ${await _getToken()}`,
      'Content-Type':  'application/json',
    };
  }

  const _base = `https://sheets.googleapis.com/v4/spreadsheets/${SID}`;

  async function _get(sheet, range = '') {
    const r   = range ? `${sheet}!${range}` : sheet;
    const url = `${_base}/values/${encodeURIComponent(r)}`;
    const res = await fetch(url, { headers: await _headers() });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'GET failed'); }
    return (await res.json()).values || [];
  }

  async function _append(sheet, rows) {
    const url = `${_base}/values/${encodeURIComponent(sheet)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, { method:'POST', headers: await _headers(), body: JSON.stringify({ values: rows }) });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'APPEND failed'); }
    _bust(sheet);
  }

  async function _put(sheet, a1, value) {
    const url = `${_base}/values/${encodeURIComponent(sheet + '!' + a1)}?valueInputOption=RAW`;
    const res = await fetch(url, { method:'PUT', headers: await _headers(), body: JSON.stringify({ values: [[value]] }) });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'PUT failed'); }
    _bust(sheet);
  }

  async function _deleteRow(sheet, rowIdx) {
    const sheetId = await _sheetId(sheet);
    const url = `${_base}:batchUpdate`;
    const res = await fetch(url, {
      method:'POST', headers: await _headers(),
      body: JSON.stringify({ requests: [{ deleteDimension: {
        range: { sheetId, dimension:'ROWS', startIndex: rowIdx-1, endIndex: rowIdx }
      }}]})
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'DELETE failed'); }
    _bust(sheet);
  }

  async function _sheetId(name) {
    const res  = await fetch(`${_base}?fields=sheets.properties`, { headers: await _headers() });
    const data = await res.json();
    const sh   = data.sheets?.find(s => s.properties.title === name);
    if (!sh) throw new Error(`Sheet "${name}" not found`);
    return sh.properties.sheetId;
  }

  function _bust(sheet) {
    if (sheet === SH.CATALOG)     _cache.catalog   = null;
    if (sheet === SH.CUSTOMERS)   _cache.customers = null;
    if (sheet === SH.ORDERS)      _cache.orders    = null;
    if (sheet === SH.ORDER_ITEMS) _cache.items     = null;
  }

  function _toObj(rows, sheet) {
    if (!rows || rows.length < 2) return [];
    const h = HEADERS[sheet];
    return rows.slice(1).map(r => Object.fromEntries(h.map((k,i) => [k, r[i] ?? ''])));
  }

  function _nextId(arr) {
    if (!arr.length) return 1;
    return Math.max(...arr.map(o => parseInt(o.id) || 0)) + 1;
  }

  function _now() { return new Date().toISOString().replace('T',' ').slice(0,19); }

  // ── Setup ────────────────────────────────────────────────────────

  async function _setup() {
    // Get existing sheet titles
    const res  = await fetch(`${_base}?fields=sheets.properties.title`, { headers: await _headers() });
    const data = await res.json();
    const have = (data.sheets||[]).map(s => s.properties.title);
    const need = Object.values(SH);
    const miss = need.filter(n => !have.includes(n));

    if (miss.length) {
      await fetch(`${_base}:batchUpdate`, {
        method:'POST', headers: await _headers(),
        body: JSON.stringify({ requests: miss.map(title => ({ addSheet: { properties: { title } } })) })
      });
    }

    // Write headers to empty sheets
    for (const sh of need) {
      const rows = await _get(sh, 'A1:Z1');
      if (!rows.length) await _append(sh, [HEADERS[sh]]);
    }

    // Seed catalog if only header row exists
    const cat = await _get(SH.CATALOG);
    if (cat.length <= 1) await _append(SH.CATALOG, CONFIG.DEFAULT_CATALOG);
  }

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════
  return {

    ready: false,

    async init() {
      await _getToken();      // authenticate immediately
      await _setup();         // create sheets + seed catalog
      this.ready = true;
      console.log('[Sheets] Connected to spreadsheet:', SID);
    },

    // ── Catalog ──────────────────────────────────────────────────

    async getCatalog(activeOnly = false) {
      if (!_cache.catalog) {
        const rows = await _get(SH.CATALOG);
        _cache.catalog = _toObj(rows, SH.CATALOG).map(i => ({
          ...i, id: parseInt(i.id), price: parseFloat(i.price), active: parseInt(i.active)
        }));
      }
      return activeOnly ? _cache.catalog.filter(i => i.active === 1) : _cache.catalog;
    },

    async addCatalogItem({ name_ar, name_en, type, price, unit }) {
      const all = await this.getCatalog();
      const id  = _nextId(all);
      await _append(SH.CATALOG, [[id, name_ar, name_en, type, parseFloat(price), unit, 1]]);
      return { id, name_ar, name_en, type, price: parseFloat(price), unit, active: 1 };
    },

    async toggleCatalogItem(id) {
      const all = await this.getCatalog();
      const idx = all.findIndex(i => i.id === id);
      if (idx === -1) throw new Error('Item not found');
      const newVal = all[idx].active === 1 ? 0 : 1;
      await _put(SH.CATALOG, `G${idx + 2}`, newVal); // G = active column
    },

    async deleteCatalogItem(id) {
      const all = await this.getCatalog();
      const idx = all.findIndex(i => i.id === id);
      if (idx === -1) throw new Error('Item not found');
      await _deleteRow(SH.CATALOG, idx + 2);
    },

    // ── Orders ───────────────────────────────────────────────────

    async saveOrder({ customer, cart, payment, notes, taxRate }) {
      const name   = customer.name.trim();
      const mobile = (customer.mobile  || '').trim();
      const addr   = (customer.address || '').trim();

      // Upsert customer
      const custs = await this.getAllCustomers();
      let custId;
      if (mobile) {
        const ex = custs.find(c => c.mobile === mobile);
        if (ex) {
          custId = parseInt(ex.id);
          const ri = custs.indexOf(ex) + 2;
          await _put(SH.CUSTOMERS, `B${ri}`, name);
          await _put(SH.CUSTOMERS, `D${ri}`, addr);
          _bust(SH.CUSTOMERS);
        }
      }
      if (!custId) {
        custId = _nextId(custs);
        await _append(SH.CUSTOMERS, [[custId, name, mobile, addr, _now()]]);
      }

      // Financials
      const sub  = cart.reduce((s,i) => s + i.price * i.quantity, 0);
      const tax  = sub * (taxRate / 100);
      const tot  = sub + tax;
      const inv  = 'FC-' + String(Date.now()).slice(-7);
      const date = new Date().toISOString().split('T')[0];

      // Order header
      const orders  = await this.getAllOrders();
      const orderId = _nextId(orders);
      await _append(SH.ORDERS, [[
        orderId, custId, inv, date, payment||'Cash', notes||'',
        +sub.toFixed(2), taxRate, +tax.toFixed(2), +tot.toFixed(2), _now()
      ]]);

      // Line items
      const items  = await this._allItems();
      let   nextId = _nextId(items);
      await _append(SH.ORDER_ITEMS, cart.map(i => [
        nextId++, orderId, i.catalog_id||'',
        i.name_ar, i.name_en, i.price, i.quantity, i.unit,
        +(i.price * i.quantity).toFixed(2)
      ]));

      _bust(SH.ORDERS); _bust(SH.ORDER_ITEMS); _bust(SH.CUSTOMERS);

      return { invoice: inv, date, subtotal: +sub.toFixed(2), tax_amount: +tax.toFixed(2), total: +tot.toFixed(2) };
    },

    async getAllOrders() {
      if (!_cache.orders) {
        const rows = await _get(SH.ORDERS);
        _cache.orders = _toObj(rows, SH.ORDERS).map(o => ({
          ...o, id: parseInt(o.id), customer_id: parseInt(o.customer_id),
          subtotal: parseFloat(o.subtotal), tax_rate: parseFloat(o.tax_rate),
          tax_amount: parseFloat(o.tax_amount), total: parseFloat(o.total),
        }));
      }
      const custs = await this.getAllCustomers();
      const items = await this._allItems();
      return [..._cache.orders].reverse().map(o => {
        const c  = custs.find(x => parseInt(x.id) === o.customer_id) || {};
        const oi = items.filter(i => parseInt(i.order_id) === o.id);
        const wt = oi.filter(i => i.unit==='kg').reduce((s,i) => s + parseFloat(i.quantity), 0);
        return { ...o, customer_name: c.name||'—', mobile: c.mobile||'', total_weight: +wt.toFixed(3) };
      });
    },

    async getOrderDetails(orderId) {
      const id     = parseInt(orderId);
      const orders = await this.getAllOrders();
      const order  = orders.find(o => o.id === id);
      if (!order) throw new Error('Order not found');
      const custs  = await this.getAllCustomers();
      const c      = custs.find(x => parseInt(x.id) === order.customer_id) || {};
      const items  = (await this._allItems())
        .filter(i => parseInt(i.order_id) === id)
        .map(i => ({ ...i, price: parseFloat(i.price), quantity: parseFloat(i.quantity), line_total: parseFloat(i.line_total) }));
      return { ...order, customer_name: c.name||'—', mobile: c.mobile||'', address: c.address||'', items };
    },

    async _allItems() {
      if (!_cache.items) {
        _cache.items = _toObj(await _get(SH.ORDER_ITEMS), SH.ORDER_ITEMS);
      }
      return _cache.items;
    },

    // ── Customers ────────────────────────────────────────────────

    async getAllCustomers() {
      if (!_cache.customers) {
        _cache.customers = _toObj(await _get(SH.CUSTOMERS), SH.CUSTOMERS);
      }
      const orders = _cache.orders || [];
      return [..._cache.customers].reverse().map(c => {
        const cid = parseInt(c.id);
        const co  = orders.filter(o => parseInt(o.customer_id) === cid);
        return { ...c, id: cid, order_count: co.length, total_spent: +co.reduce((s,o) => s + parseFloat(o.total||0), 0).toFixed(2) };
      });
    },

    // ── Stats ────────────────────────────────────────────────────

    async getStats() {
      const [orders, customers, catalog, items] = await Promise.all([
        this.getAllOrders(), this.getAllCustomers(), this.getCatalog(true), this._allItems()
      ]);
      return {
        total_orders:    orders.length,
        total_customers: customers.length,
        total_revenue:   +orders.reduce((s,o) => s+parseFloat(o.total||0), 0).toFixed(2),
        total_kg_sold:   +items.filter(i=>i.unit==='kg').reduce((s,i)=>s+parseFloat(i.quantity||0),0).toFixed(3),
        active_products: catalog.length,
      };
    },

    // ── Export CSV (opens in Excel / Access) ─────────────────────

    exportToCSV() {
      const orders    = _cache.orders || [];
      const customers = _cache.customers || [];
      const items     = _cache.items || [];

      const toCSV = (headers, rows) => {
        const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
        return [headers.map(esc).join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
      };

      // Orders CSV
      _download('BahrCoffee_Orders.csv',
        toCSV(['id','invoice','date','customer_id','payment','notes','subtotal','tax_rate','tax_amount','total','created_at'], orders));

      // Customers CSV
      setTimeout(() => _download('BahrCoffee_Customers.csv',
        toCSV(['id','name','mobile','address','created_at'], customers)), 300);

      // Items CSV
      setTimeout(() => _download('BahrCoffee_OrderItems.csv',
        toCSV(['id','order_id','catalog_id','name_ar','name_en','price','quantity','unit','line_total'], items)), 600);
    },
  };

  function _download(filename, csv) {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

})();
