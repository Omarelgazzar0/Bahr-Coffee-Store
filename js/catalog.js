// public/js/catalog.js — Catalog Manager & POS Grid
'use strict';

const Catalog = (() => {
  let _items = [];
  const _cart = new Map();
  const STEP  = { kg: 0.025, g: 25, piece: 1, pack: 1 };
  const TYPE_LABEL = { coffee: '☕ Coffee', package: '📦 Package', ingredient: '🧂 Ingredient' };
  const TYPE_BADGE = { coffee: 'badge-amber', package: 'badge-teal', ingredient: 'badge-violet' };

  function _buildCard(item) {
    const qty  = _cart.get(item.id) || 0;
    const step = STEP[item.unit] ?? 1;
    const qtyText = qty <= 0 ? '—'
      : item.unit === 'kg' ? qty.toFixed(3) + ' kg'
      : item.unit === 'g'  ? qty + ' g'
      : qty + ' ' + item.unit;

    return `
      <div class="catalog-card ${qty > 0 ? 'selected' : ''}" id="card-${item.id}" data-id="${item.id}" data-type="${item.type}">
        <div class="card-type-badge">${TYPE_LABEL[item.type] ?? item.type}</div>
        <div class="card-name-ar rtl">${item.name_ar}</div>
        <div class="card-name-en">${item.name_en}</div>
        <div class="card-price"><span>EGP ${item.price.toLocaleString('en-EG')}</span><span class="price-unit">/ ${item.unit}</span></div>
        <div class="qty-row">
          <span class="qty-label">Qty (${item.unit})</span>
          <div class="qty-controls">
            <button class="qty-btn" onclick="Catalog._adjust(${item.id}, -${step})">−</button>
            <span class="qty-display" id="qty-${item.id}">${qtyText}</span>
            <button class="qty-btn" onclick="Catalog._adjust(${item.id},  ${step})">+</button>
          </div>
        </div>
      </div>`;
  }

  function _refreshCard(itemId) {
    const item   = _items.find(i => i.id === itemId);
    const qty    = _cart.get(itemId) || 0;
    const qtyEl  = document.getElementById('qty-' + itemId);
    const cardEl = document.getElementById('card-' + itemId);
    if (qtyEl) qtyEl.textContent = qty <= 0 ? '—'
      : item?.unit === 'kg' ? qty.toFixed(3) + ' kg'
      : item?.unit === 'g'  ? qty + ' g'
      : qty + ' ' + (item?.unit ?? '');
    if (cardEl) cardEl.classList.toggle('selected', qty > 0);
  }

  return {
    _adjust(itemId, delta) {
      const next = Math.round((((_cart.get(itemId) || 0) + delta) * 10000)) / 10000;
      if (next <= 0) _cart.delete(itemId); else _cart.set(itemId, next);
      _refreshCard(itemId);
      App?.onCartChange();
    },

    async load() {
      _items = await DB.getCatalog(true);
      const grid = document.getElementById('catalogGrid');
      if (!grid) return;
      grid.innerHTML = _items.length
        ? _items.map(_buildCard).join('')
        : `<p class="muted" style="grid-column:1/-1;text-align:center;padding:2rem">No active items. Add some in the Catalog tab.</p>`;
    },

    clearCart() {
      _cart.clear();
      _items.forEach(i => _refreshCard(i.id));
      App?.onCartChange();
    },

    getCartItems() {
      const lines = [];
      _cart.forEach((qty, id) => {
        const item = _items.find(i => i.id === id);
        if (!item) return;
        lines.push({ catalog_id: item.id, nameAr: item.name_ar, nameEn: item.name_en,
          name_ar: item.name_ar, name_en: item.name_en,
          price: item.price, quantity: qty, unit: item.unit, lineTotal: item.price * qty });
      });
      return lines;
    },

    getCartTotals(taxRate = 14) {
      const lines     = this.getCartItems();
      const subtotal  = lines.reduce((s, l) => s + l.lineTotal, 0);
      const taxAmount = subtotal * (taxRate / 100);
      const totalKg   = lines.filter(l => l.unit === 'kg').reduce((s, l) => s + l.quantity, 0);
      return { subtotal, taxAmount, grandTotal: subtotal + taxAmount, totalKg, itemCount: lines.length };
    },

    async buildCatalogTable() {
      const all   = await DB.getCatalog(false);
      const tbody = document.getElementById('catalogTableBody');
      if (!tbody) return;
      tbody.innerHTML = !all.length
        ? `<tr><td colspan="8" class="table-empty">No items yet</td></tr>`
        : all.map(item => `
            <tr style="${item.active ? '' : 'opacity:.45'}">
              <td><span class="badge badge-amber">${item.id}</span></td>
              <td class="rtl mono">${item.name_ar}</td>
              <td>${item.name_en}</td>
              <td><span class="badge ${TYPE_BADGE[item.type] ?? 'badge-sky'}">${TYPE_LABEL[item.type] ?? item.type}</span></td>
              <td class="mono">EGP ${item.price.toLocaleString('en-EG')}</td>
              <td class="mono">${item.unit}</td>
              <td><span class="badge ${item.active ? 'badge-teal' : 'badge-coral'}">${item.active ? 'Active' : 'Archived'}</span></td>
              <td style="display:flex;gap:.35rem;flex-wrap:wrap">
                <button class="btn btn-teal btn-sm"  onclick="Catalog._onToggle(${item.id})">${item.active ? 'Archive' : 'Restore'}</button>
                <button class="btn btn-danger"        onclick="Catalog._onDelete(${item.id})">Delete</button>
              </td>
            </tr>`).join('');
    },

    async _onToggle(id) {
      try { await DB.toggleCatalogItem(id); await this.buildCatalogTable(); await this.load(); App?.toast('Updated'); }
      catch (e) { App?.toast(e.message, 'error'); }
    },

    async _onDelete(id) {
      if (!confirm('Delete this item? If it has been ordered it will be archived instead.')) return;
      try { await DB.deleteCatalogItem(id); await this.buildCatalogTable(); await this.load(); App?.toast('Removed'); }
      catch (e) { App?.toast(e.message, 'error'); }
    },
  };
})();
