// ═══════════════════════════════════════════════════════════════════
// js/catalog.js — Cart & Catalog Manager
//
// Classes:
//   Cart            → in-memory quantities (catalogId → qty), totals
//   CatalogManager  → fetches items from Sheets, renders the POS grid
//                      and the admin table, owns the Cart instance
//
// Usage:
//   await Catalog.load()
//   Catalog.getCartItems()
//   Catalog.getCartTotals(14)
// ═══════════════════════════════════════════════════════════════════
'use strict';


/* ═══════════════════════════════════════════════════════════════════
   CLASS: Cart
   Pure data structure — holds selected quantities per catalog item
   and computes totals. Knows nothing about the DOM.
═══════════════════════════════════════════════════════════════════ */
class Cart {
  constructor() {
    this._quantities = new Map(); // catalogId → quantity
  }

  /** Step size for +/- buttons, based on the item's unit. */
  static stepFor(unit) {
    const steps = { kg: 0.010, g: 10, piece: 1, pack: 1 };
    return steps[unit] ?? 1;
  }

  get(itemId) {
    return this._quantities.get(itemId) || 0;
  }

  /** Adjust quantity by delta, removing the item if it reaches zero. */
  adjust(itemId, delta) {
    const next = Math.round((this.get(itemId) + delta) * 10_000) / 10_000;
    if (next <= 0) this._quantities.delete(itemId);
    else            this._quantities.set(itemId, next);
    return this.get(itemId);
  }

  remove(itemId) {
    this._quantities.delete(itemId);
  }

  clear() {
    this._quantities.clear();
  }

  get size() {
    return this._quantities.size;
  }

  /** Build cart line objects by joining quantities with catalog items. */
  toLines(catalogItems) {
    const lines = [];
    this._quantities.forEach((qty, itemId) => {
      const item = catalogItems.find(i => i.id === itemId);
      if (!item) return; // item may have been archived/deleted
      lines.push({
        catalog_id: item.id,
        nameAr:     item.name_ar,
        nameEn:     item.name_en,
        name_ar:    item.name_ar,
        name_en:    item.name_en,
        price:      item.price,
        quantity:   qty,
        unit:       item.unit,
        lineTotal:  item.price * qty,
      });
    });
    return lines;
  }

  /** Compute subtotal, tax, grand total, and total weight (kg only). */
  totals(catalogItems, taxRate = 14) {
    const lines     = this.toLines(catalogItems);
    const subtotal  = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const taxAmount = subtotal * (taxRate / 100);

    // Packages/pieces never count toward physical weight
    const totalKg = lines
      .filter(l => l.unit === 'kg')
      .reduce((sum, l) => sum + l.quantity, 0);

    return {
      subtotal,
      taxAmount,
      grandTotal: subtotal + taxAmount,
      totalKg,
      itemCount: lines.length,
    };
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: CatalogManager
   Owns the Cart instance, fetches catalog data from Sheets, and
   renders both the POS product grid and the admin management table.
═══════════════════════════════════════════════════════════════════ */
class CatalogManager {
  constructor(sheetsAPI) {
    this.sheets = sheetsAPI;
    this.cart   = new Cart();
    this._items = []; // active catalog items, refreshed on load()

    this.TYPE_LABEL = { coffee: '☕ Coffee', package: '📦 Package', ingredient: '🧂 Ingredient' };
    this.TYPE_BADGE = { coffee: 'badge-amber', package: 'badge-teal', ingredient: 'badge-violet' };
  }

  // ── Loading ────────────────────────────────────────────────────

  /** Fetch active catalog items and render the POS selection grid. */
  async load() {
    this._items = await this.sheets.getCatalog(true);
    this._renderGrid();
  }

  // ── Cart pass-through (called from app.js) ───────────────────────

  getCartItems() {
    return this.cart.toLines(this._items);
  }

  getCartTotals(taxRate = 14) {
    return this.cart.totals(this._items, taxRate);
  }

  clearCart() {
    this.cart.clear();
    this._items.forEach(item => this._refreshCard(item.id));
    App?.onCartChange();
  }

  /** Called from inline onclick handlers on +/- buttons. */
  adjustQuantity(itemId, delta) {
    this.cart.adjust(itemId, delta);
    this._refreshCard(itemId);
    App?.onCartChange();
  }

  // ── POS Grid rendering ────────────────────────────────────────────

  _renderGrid() {
    const grid = document.getElementById('catalogGrid');
    if (!grid) return;

    grid.innerHTML = this._items.length
      ? this._items.map(item => this._cardHTML(item)).join('')
      : `<p class="muted" style="grid-column:1/-1;text-align:center;padding:2rem">
           No active items. Add some in the Catalog tab.
         </p>`;
  }

  _cardHTML(item) {
    const qty  = this.cart.get(item.id);
    const step = Cart.stepFor(item.unit);

    return `
      <div class="catalog-card ${qty > 0 ? 'selected' : ''}"
           id="card-${item.id}" data-id="${item.id}" data-type="${item.type}">
        <div class="card-type-badge">${this.TYPE_LABEL[item.type] ?? item.type}</div>
        <div class="card-name-ar rtl">${item.name_ar}</div>
        <div class="card-name-en">${item.name_en}</div>
        <div class="card-price">
          <span>EGP ${Number(item.price).toLocaleString('en-EG')}</span>
          <span class="price-unit">/ ${item.unit}</span>
        </div>
        <div class="qty-row">
          <span class="qty-label">Qty (${item.unit})</span>
          <div class="qty-controls">
            <button class="qty-btn" onclick="Catalog.adjustQuantity(${item.id}, -${step})">−</button>
            <span class="qty-display" id="qty-${item.id}">${this._formatQty(qty, item.unit)}</span>
            <button class="qty-btn" onclick="Catalog.adjustQuantity(${item.id}, ${step})">+</button>
          </div>
        </div>
      </div>`;
  }

  /** Update just one card's quantity display without rebuilding the grid. */
  _refreshCard(itemId) {
    const item = this._items.find(i => i.id === itemId);
    const qty  = this.cart.get(itemId);

    const qtyEl  = document.getElementById('qty-' + itemId);
    const cardEl = document.getElementById('card-' + itemId);

    if (qtyEl)  qtyEl.textContent = this._formatQty(qty, item?.unit);
    if (cardEl) cardEl.classList.toggle('selected', qty > 0);
  }

  _formatQty(qty, unit) {
    if (qty <= 0) return '—';
    if (unit === 'kg') return qty.toFixed(3) + ' kg';
    if (unit === 'g')  return qty + ' g';
    return qty + ' ' + (unit ?? '');
  }

  // ── Admin table (Catalog management page) ─────────────────────────

  /** Render the full catalog table (active + archived) with controls. */
  async buildCatalogTable() {
    const all   = await this.sheets.getCatalog(false);
    const tbody = document.getElementById('catalogTableBody');
    if (!tbody) return;

    tbody.innerHTML = !all.length
      ? `<tr><td colspan="8" class="table-empty">No items yet</td></tr>`
      : all.map(item => this._tableRowHTML(item)).join('');
  }

  _tableRowHTML(item) {
    const badge = this.TYPE_BADGE[item.type] ?? 'badge-sky';
    const label = this.TYPE_LABEL[item.type] ?? item.type;

    return `
      <tr style="${item.active ? '' : 'opacity:.45'}">
        <td><span class="badge badge-amber">${item.id}</span></td>
        <td class="rtl mono">${item.name_ar}</td>
        <td>${item.name_en}</td>
        <td><span class="badge ${badge}">${label}</span></td>
        <td class="mono">EGP ${Number(item.price).toLocaleString('en-EG')}</td>
        <td class="mono">${item.unit}</td>
        <td><span class="badge ${item.active ? 'badge-teal' : 'badge-coral'}">${item.active ? 'Active' : 'Archived'}</span></td>
        <td style="display:flex;gap:.35rem;flex-wrap:wrap">
          <button class="btn btn-teal btn-sm" onclick="Catalog.toggleItem(${item.id})">${item.active ? 'Archive' : 'Restore'}</button>
          <button class="btn btn-danger" onclick="Catalog.deleteItem(${item.id})">Delete</button>
        </td>
      </tr>`;
  }

  async toggleItem(id) {
    try {
      await this.sheets.toggleCatalogItem(id);
      await this.buildCatalogTable();
      await this.load();
      App?.toast.show('Item updated');
    } catch (e) { App?.toast.show(e.message, 'error'); }
  }

  async deleteItem(id) {
    if (!confirm('Delete this item?')) return;
    try {
      await this.sheets.deleteCatalogItem(id);
      await this.buildCatalogTable();
      await this.load();
      App?.toast.show('Item removed');
    } catch (e) { App?.toast.show(e.message, 'error'); }
  }
}


// ── Single shared instance used by the rest of the app ───────────────
const Catalog = new CatalogManager(Sheets);
