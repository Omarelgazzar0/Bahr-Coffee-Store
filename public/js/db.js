// public/js/db.js — Frontend REST API Client
// All methods async. Throws on non-2xx responses.
'use strict';

const DB = (() => {
  async function _fetch(path, options = {}) {
    if (options.body && typeof options.body === 'object') {
      options.body    = JSON.stringify(options.body);
      options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    }
    const res  = await fetch('/api' + path, options);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  return {
    async init() { console.log('[DB] API client →', window.location.origin); },

    // Catalog
    async getCatalog(activeOnly = false) { return _fetch('/catalog' + (activeOnly ? '?active=true' : '')); },
    async addCatalogItem(item)           { return _fetch('/catalog', { method: 'POST', body: item }); },
    async toggleCatalogItem(id)          { return _fetch(`/catalog/${id}/toggle`, { method: 'PATCH' }); },
    async deleteCatalogItem(id)          { return _fetch(`/catalog/${id}`, { method: 'DELETE' }); },

    // Orders
    async saveOrder({ customer, cart, payment, notes, taxRate }) {
      return _fetch('/orders', { method: 'POST', body: { customer, cart, payment, notes, tax_rate: taxRate } });
    },
    async getAllOrders()         { return _fetch('/orders'); },
    async getOrderDetails(id)   { return _fetch(`/orders/${id}`); },

    // Customers
    async getAllCustomers()      { return _fetch('/customers'); },

    // Stats
    async getStats()             { return _fetch('/stats'); },
  };
})();
