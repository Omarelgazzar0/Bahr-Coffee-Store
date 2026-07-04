// ═══════════════════════════════════════════════════════════════════
// js/app.js — Main Application Controller
//
// Classes:
//   ThemeManager   → dark/light theme toggle, persisted in localStorage
//   Toast          → bottom notification messages
//   Router         → page switching (POS / Catalog / Customers / Orders)
//   CartDrawer     → mobile slide-up cart panel + swipe-to-close
//   ReceiptModal   → printable customer receipt
//   LoadingScreen  → full-page boot/connecting indicator
//   AppController  → wires everything together, owns event listeners
//
// Boot sequence:
//   DOMContentLoaded → AppController.start()
//     1. Sheets.init()    — authenticate + ensure sheet tabs exist
//     2. Catalog.load()   — fetch active catalog, render POS grid
//     3. wire all events, render initial UI state
// ═══════════════════════════════════════════════════════════════════
'use strict';


/* ═══════════════════════════════════════════════════════════════════
   CLASS: ThemeManager
   Toggles [data-theme] on <html> between 'dark' and 'light' and
   remembers the choice in localStorage. The actual initial theme is
   already applied by a tiny inline script in <head> (before first
   paint) — this class just handles the button + persists changes.
═══════════════════════════════════════════════════════════════════ */
class ThemeManager {
  constructor(storageKey = 'bahr_theme') {
    this.key = storageKey;
    this.btn = document.getElementById('themeToggle');
  }

  current() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(this.key, theme);
  }

  toggle() {
    this.set(this.current() === 'dark' ? 'light' : 'dark');
  }

  wire() {
    this.btn?.addEventListener('click', () => {
      this.toggle();
      if (document.getElementById('page-customers')?.classList.contains('active')) {
        App?._renderDashboardCharts();
      }
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: Toast
   Simple bottom-corner notification. One instance, reused for every
   message — calling show() again replaces the current toast.
═══════════════════════════════════════════════════════════════════ */
class Toast {
  constructor(elementId = 'toastEl') {
    this.el    = document.getElementById(elementId);
    this.timer = null;
  }

  show(message, type = 'success') {
    if (!this.el) return;
    if (this.timer) clearTimeout(this.timer);

    this.el.textContent = message;
    this.el.className   = `visible toast-${type}`;
    this.timer = setTimeout(() => { this.el.className = ''; }, 3000);
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: Router
   Switches between the 4 top-level pages and keeps both the desktop
   nav bar and the mobile bottom nav in sync. Triggers each page's
   data-loading callback the first time it becomes visible.
═══════════════════════════════════════════════════════════════════ */
class Router {
  constructor(onNavigate) {
    this.onNavigate = onNavigate; // callback(pageName)
  }

  goTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page)?.classList.add('active');

    document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.page === page)
    );

    this.onNavigate?.(page);
  }

  wireNavButtons() {
    document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(btn =>
      btn.addEventListener('click', () => this.goTo(btn.dataset.page))
    );
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: CartDrawer
   On mobile, the cart panel slides up from the bottom instead of
   sitting beside the product grid. Handles open/close state and a
   swipe-down-to-dismiss gesture.
═══════════════════════════════════════════════════════════════════ */
class CartDrawer {
  constructor() {
    this.panel = document.querySelector('.pos-right');
    this.page  = document.getElementById('page-pos');
  }

  open() {
    this.page?.classList.add('cart-open');
    if (this.page && !this.page.querySelector('.cart-drawer-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'cart-drawer-overlay';
      overlay.addEventListener('click', () => this.close());
      this.page.appendChild(overlay);
    }
  }

  close() {
    this.page?.classList.remove('cart-open');
  }

  toggle() {
    this.page?.classList.contains('cart-open') ? this.close() : this.open();
  }

  /** Drag the panel down with a finger; release past 80px to close it. */
  wireSwipeToClose() {
    if (!this.panel) return;
    let startY = 0;
    let dragging = false;

    this.panel.addEventListener('touchstart', e => {
      startY   = e.touches[0].clientY;
      dragging = true;
    }, { passive: true });

    this.panel.addEventListener('touchmove', e => {
      if (!dragging) return;
      const delta = e.touches[0].clientY - startY;
      if (delta > 0 && this.panel.scrollTop === 0) {
        this.panel.style.transform = `translateY(${Math.min(delta * 0.4, 60)}px)`;
      }
    }, { passive: true });

    this.panel.addEventListener('touchend', e => {
      if (!dragging) return;
      dragging = false;
      this.panel.style.transform = '';
      if (e.changedTouches[0].clientY - startY > 80) this.close();
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: ReceiptModal
   Renders and shows the printable customer receipt. Intentionally
   minimal — only name, address, mobile, weight, and total (no
   itemised product breakdown), per the store's receipt policy.
═══════════════════════════════════════════════════════════════════ */
class ReceiptModal {
  constructor() {
    this.overlay = document.getElementById('receiptOverlay');
    this.content = document.getElementById('receiptContent');
  }

  static escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  static formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString('en-EG', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  show({ invoice, date, custName, mobile, address, taxRate, subtotal, taxAmount, grandTotal, totalKg, payment, presetName }) {
    const esc = ReceiptModal.escapeHtml;
    const fmt = ReceiptModal.formatDate;

    // Keep full data around so the PDF/WhatsApp share button can rebuild the receipt
    this._last = { invoice, date, custName, mobile, address, taxRate, subtotal, taxAmount, grandTotal, totalKg, payment, presetName };

    this.content.innerHTML = `
      <div class="rp-brand">
        <h2>Bahr Coffee Store</h2>
        <div class="tagline">rise &amp; grind</div>
      </div>
      <hr class="rp-divider"/>
      <div class="rp-info">
        <span class="rk">Invoice</span>  <span class="rv mono">${invoice}</span>
        <span class="rk">Date</span>     <span class="rv">${fmt(date)}</span>
        <span class="rk">Payment</span>  <span class="rv">${payment}</span>
        ${presetName ? `<span class="rv-mono">${esc(presetName)}</span>` : ''}
      </div>
      <hr class="rp-divider"/>
      <div class="rp-info">
        <span class="rk">Customer</span> <span class="rv">${esc(custName)}</span>
        ${mobile  ? `<span class="rk">Mobile</span><span class="rv mono">${esc(mobile)}</span>` : ''}
        ${address ? `<span class="rk">Address</span><span class="rv">${esc(address).replace(/\n/g, '<br/>')}</span>` : ''}
      </div>
      <hr class="rp-divider"/>
      <div class="rp-summary">
        <div class="rp-summary-row"><span class="sk">Total Weight</span><span class="sv mono">${Number(totalKg).toFixed(3)} kg</span></div>
        <!--
            <div class="rp-summary-row"><span class="sk">Subtotal</span><span class="sv mono">EGP ${Number(subtotal).toFixed(2)}</span></div>
            <div class="rp-summary-row"><span class="sk">Tax (${taxRate}%)</span><span class="sv mono">EGP ${Number(taxAmount).toFixed(2)}</span></div>
        -->
        <div class="rp-summary-row final"><span class="sk">TOTAL DUE</span><span class="sv mono">EGP ${Number(grandTotal).toFixed(2)}</span></div>
      </div>
      <div class="rp-footer">☕ Thank you for choosing Bahr Coffee Store ☕<br/>Rise &amp; Grind — Every Cup Counts</div>`;

    // Show/hide the WhatsApp button depending on whether we have a mobile number
    const waBtn = document.getElementById('btnShareWhatsApp');
    if (waBtn) waBtn.style.display = mobile ? '' : 'none';

    this.overlay?.classList.add('open');
  }

  /** Build a one-page PDF replicating the receipt (name/address/mobile/weight/total only). */
  buildPDF() {
    const { invoice, date, custName, mobile, address, grandTotal, totalKg, payment } = this._last;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: [80, 150] }); // narrow receipt-style page

    let y = 14;
    const centerX = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Bahr Coffee Store', centerX, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text('rise & grind', centerX, y, { align: 'center' });
    y += 6;

    doc.setDrawColor(180);
    doc.line(6, y, 74, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const row = (label, value) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, 6, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(value), 74, y, { align: 'right' });
      y += 6;
    };

    row('Invoice:', invoice);
    row('Date:', ReceiptModal.formatDate(date));
    row('Payment:', payment);
    y += 2;
    doc.line(6, y, 74, y);
    y += 7;

    row('Customer:', custName);
    if (mobile)  row('Mobile:', mobile);
    if (address) {
      doc.setFont('helvetica', 'bold');
      doc.text('Address:', 6, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(address, 68);
      lines.forEach(line => { doc.text(line, 6, y); y += 5; });
      y += 1;
    }

    y += 2;
    doc.line(6, y, 74, y);
    y += 7;

    row('Total Weight:', `${Number(totalKg).toFixed(3)} kg`);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('TOTAL DUE:', 6, y);
    doc.text(`EGP ${Number(grandTotal).toFixed(2)}`, 74, y, { align: 'right' });
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Thank you for choosing Bahr Coffee Store', centerX, y, { align: 'center' });
    y += 4;
    doc.text('Rise & Grind — Every Cup Counts', centerX, y, { align: 'center' });

    return doc;
  }

  /**
   * Open the customer's specific WhatsApp chat and download the receipt PDF
   * so it's the newest file ready to attach.
   *
   * Note on what's technically possible: no browser can auto-attach a file
   * into a specific WhatsApp contact's chat — both iOS and Android block
   * that for security/privacy, and the only way around it is WhatsApp's
   * paid Business API (a separate server-side system). This is the most
   * reliable flow achievable from a plain website: it deep-links straight
   * into the right chat, and the PDF is downloaded right after so it's one
   * tap (📎 → Recent) away from being sent.
   */
  shareReceiptPDF() {
    if (!this._last) return;
    const { invoice, mobile } = this._last;

    if (!mobile) {
      App?.toast.show('No mobile number on file for this customer', 'error');
      return;
    }

    // Open the WhatsApp chat FIRST and synchronously (still inside the
    // click handler) — waiting until after any async work risks the
    // browser treating it as a blocked popup instead of a real click.
    let phone = mobile.replace(/[^\d]/g, '');
    if (phone.startsWith('0')) phone = phone.slice(1);
    if (!phone.startsWith('20')) phone = '20' + phone;
    window.open(`https://wa.me/${phone}`, '_blank');

    // Now build and download the PDF so it's ready to attach
    try {
      const doc = this.buildPDF();
      doc.save(`Receipt-${invoice}.pdf`);
      App?.toast.show('✓ Chat opened — tap 📎 and attach the PDF that just downloaded');
    } catch (e) {
      App?.toast.show('Could not build PDF: ' + e.message, 'error');
    }
  }

  close() {
    this.overlay?.classList.remove('open');
  }

  wireCloseButtons() {
    document.getElementById('btnCloseModal')?.addEventListener('click', () => this.close());
    document.getElementById('btnCloseModal2')?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', e => {
      if (e.target === e.currentTarget) this.close();
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: LoadingScreen
   Full-page overlay shown while authenticating with Google Sheets
   and loading initial data. Shows step-by-step progress messages.
═══════════════════════════════════════════════════════════════════ */
class LoadingScreen {
  show(message) {
    let el = document.getElementById('loadingScreen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loadingScreen';
      el.style.cssText = `
        position:fixed;inset:0;background:#000;display:flex;flex-direction:column;
        align-items:center;justify-content:center;z-index:9999;gap:1rem;font-family:sans-serif`;
      el.innerHTML = `
        <div style="font-size:3rem">☕</div>
        <div style="color:#fff;font-size:1.1rem;font-weight:600">Bahr Coffee Store</div>
        <div id="loadingMsg" style="color:#888;font-size:.85rem"></div>
        <div style="width:200px;height:2px;background:#222;border-radius:1px;overflow:hidden;margin-top:.5rem">
          <div style="height:100%;background:#fff;animation:ldBar 1.5s ease-in-out infinite;width:40%"></div>
        </div>
        <style>@keyframes ldBar{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}</style>`;
      document.body.appendChild(el);
    }
    const msgEl = document.getElementById('loadingMsg');
    if (msgEl) msgEl.textContent = message;
  }

  hide() {
    document.getElementById('loadingScreen')?.remove();
  }

  /** Replace the entire page with a friendly, actionable error screen. */
  showError(err) {
    this.hide();
    const esc = ReceiptModal.escapeHtml;
    const msg = err.message || '';

    const isShareError  = /403|permission|forbidden/i.test(msg);
    const isApiDisabled = /disabled|SERVICE_DISABLED/i.test(msg);
    const isTimeout      = /timed out/i.test(msg);
    const isAuthError    = /auth failed|invalid_grant|unauthorized/i.test(msg);

    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                  background:#000;color:#fff;font-family:sans-serif;padding:2rem;text-align:center;gap:1rem">
        <div style="font-size:3rem">☕</div>
        <h2 style="color:#FF3B3B">Cannot connect to Google Sheets</h2>
        <code style="background:#111;border:1px solid #333;padding:.5rem 1rem;border-radius:6px;
                     color:#aaa;font-size:.75rem;max-width:500px;word-break:break-all;display:block">${esc(msg)}</code>

        ${(isShareError || isTimeout) ? `
        <div style="background:#111;border:1px solid #FF3B3B;border-radius:8px;padding:1.25rem;max-width:460px;text-align:left">
          <p style="color:#FF3B3B;font-weight:700;margin-bottom:.75rem">⚠️ Share the spreadsheet with the service account</p>
          <p style="color:#888;font-size:.82rem;line-height:1.6">
            1. Open your <a href="https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}" target="_blank" style="color:#fff">Google Sheet</a><br/>
            2. Click <strong style="color:#fff">Share</strong><br/>
            3. Add as <strong style="color:#fff">Editor</strong>:<br/>
            <code style="color:#fff;background:#222;padding:.2rem .5rem;border-radius:3px;font-size:.75rem;display:block;margin-top:.4rem;word-break:break-all">${esc(CONFIG.SERVICE_ACCOUNT.client_email)}</code><br/>
            4. <strong style="color:#fff">Send</strong> → reload this page
          </p>
        </div>` : ''}

        ${isApiDisabled ? `
        <div style="background:#111;border:1px solid #FF3B3B;border-radius:8px;padding:1.25rem;max-width:460px;text-align:left">
          <p style="color:#FF3B3B;font-weight:700;margin-bottom:.75rem">⚠️ Google Sheets API is not enabled</p>
          <p style="color:#888;font-size:.82rem">Enable it in Google Cloud Console for this project.</p>
        </div>` : ''}

        ${isAuthError ? `
        <div style="background:#111;border:1px solid #FF3B3B;border-radius:8px;padding:1.25rem;max-width:460px;text-align:left">
          <p style="color:#FF3B3B;font-weight:700;margin-bottom:.75rem">⚠️ Service account authentication failed</p>
          <p style="color:#888;font-size:.82rem">Check that the private key in config.js is valid.</p>
        </div>` : ''}

        <button onclick="location.reload()"
                style="padding:.75rem 2rem;background:#fff;color:#000;border:none;border-radius:6px;
                       cursor:pointer;font-weight:700;font-size:.9rem;margin-top:.5rem">
          🔄 Try Again
        </button>
        <p style="color:#444;font-size:.75rem">Open DevTools → Console for full details</p>
      </div>`;
  }
}


/* ═══════════════════════════════════════════════════════════════════
   CLASS: AppController
   Top-level controller. Owns all the smaller UI classes, wires every
   DOM event, and drives the page-specific render functions.
═══════════════════════════════════════════════════════════════════ */
class AppController {
  constructor() {
    this.theme    = new ThemeManager();
    this.toast    = new Toast();
    this.router   = new Router(page => this._onNavigate(page));
    this.drawer   = new CartDrawer();
    this.receipt  = new ReceiptModal();
    this.loading  = new LoadingScreen();
    this._activePresetName = null; // set when a preset is applied, cleared on manual edit / clear / save
  }

  // ── Boot sequence ──────────────────────────────────────────────

  async start() {
    this.loading.show('Connecting to Google Sheets…');

    try {
      this.loading.show('Step 1 / 3 — Signing in…');
      await this._withTimeout(Sheets.init(), 20_000, 'Sheets.init()');

      this.loading.show('Step 2 / 3 — Loading catalog…');
      await this._withTimeout(Catalog.load(), 15_000, 'Catalog.load()');

      this.loading.show('Step 3 / 3 — Starting POS…');
      this._wireEvents();
      this._setHeaderMeta();
      await this._renderPresets();
      this.loading.hide();

      console.log('[App] ✓ Bahr Coffee Store POS ready.');
    } catch (err) {
      console.error('[App] Startup failed:', err);
      this.loading.showError(err);
    }
  }

  _withTimeout(promise, ms, label) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s at: ${label}`)), ms)
    );
    return Promise.race([promise, timeout]);
  }

  _setHeaderMeta() {
    const dateEl = document.getElementById('cartDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-EG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const badge = document.getElementById('invoiceBadge');
    if (badge) badge.textContent = 'BC-' + String(Date.now()).slice(-7);
  }

  // ── Event wiring ───────────────────────────────────────────────

  _wireEvents() {
    this.theme.wire();
    this.router.wireNavButtons();
    this.receipt.wireCloseButtons();
    this.drawer.wireSwipeToClose();

    // Redraw dashboard charts on resize (canvas pixel size is fixed at draw time)
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (document.getElementById('page-customers')?.classList.contains('active')) {
          this._renderDashboardCharts();
        }
      }, 250);
    });

    document.querySelectorAll('.pill').forEach(pill =>
      pill.addEventListener('click', () => {
        document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      })
    );

    document.getElementById('taxRate')?.addEventListener('input', () => {
      this._syncTaxEGP();
      this._renderCart();
    });
    document.getElementById('taxRateEGP')?.addEventListener('input', () => {
      this._syncTaxRate();
      this._renderCart();
    });
    document.getElementById('btnSaveOrder')?.addEventListener('click', () => this._saveOrder());
    document.getElementById('btnClearOrder')?.addEventListener('click', () => this._clearOrder(true));
    document.getElementById('btnAddItem')?.addEventListener('click', () => this._addCatalogItem());
    document.getElementById('cartFab')?.addEventListener('click', () => this.drawer.toggle());

    document.querySelectorAll('.export-csv-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        Sheets.exportToCSV();
        this.toast.show('Downloading 3 CSV files…');
      })
    );

    document.getElementById('btnSavePreset')?.addEventListener('click', () => this._savePreset());
    document.getElementById('presetsGrid')?.addEventListener('click', e => {
      const applyBtn = e.target.closest('.preset-apply-btn');
      const deleteBtn = e.target.closest('.preset-delete-btn');
      if (applyBtn) {
        this.applyPreset(applyBtn.dataset.name);
      } else if (deleteBtn) {
        this.deletePreset(deleteBtn.dataset.name);
      }
    });
  }

  // ── Navigation ─────────────────────────────────────────────────

  _onNavigate(page) {
    if (page !== 'pos') this.drawer.close();
    if (page === 'customers') this._renderCustomersPage();
    if (page === 'orders')    this._renderOrdersPage();
    if (page === 'catalog')   Catalog.buildCatalogTable();
  }

  // ── Tax field sync ─────────────────────────────────────────────

  /** % changed → recompute EGP from current subtotal. */
  _syncTaxEGP() {
    const rate     = parseFloat(document.getElementById('taxRate')?.value) || 0;
    const subtotal = Catalog.getCartTotals(0).subtotal;
    const egpEl    = document.getElementById('taxRateEGP');
    if (egpEl) egpEl.value = subtotal > 0 ? (subtotal * rate / 100).toFixed(2) : '';
  }

  /** EGP changed → back-calculate % from current subtotal. */
  _syncTaxRate() {
    const egp      = parseFloat(document.getElementById('taxRateEGP')?.value) || 0;
    const subtotal = Catalog.getCartTotals(0).subtotal;
    const rateEl   = document.getElementById('taxRate');
    if (rateEl && subtotal > 0) rateEl.value = (egp / subtotal * 100).toFixed(4);
  }

  // ── Cart panel ─────────────────────────────────────────────────

  /** Called by CatalogManager whenever the cart contents change. */
  onCartChange() {
    this._renderCart();
  }

  _renderCart() {
    const taxRate = parseFloat(document.getElementById('taxRate')?.value) || 20;
    const lines   = Catalog.getCartItems();
    const totals  = Catalog.getCartTotals(taxRate);

    // Keep EGP field synced unless the user is actively typing in it
    const egpEl = document.getElementById('taxRateEGP');
    if (egpEl && document.activeElement !== egpEl) {
      egpEl.value = totals.subtotal > 0 ? totals.taxAmount.toFixed(2) : '';
    }

    const itemsEl  = document.getElementById('cartItems');
    const totalsEl = document.getElementById('cartTotals');
    const badge    = document.getElementById('cartFabBadge');

    if (badge) {
      badge.textContent = lines.length;
      badge.setAttribute('data-count', lines.length);
    }

    if (!lines.length) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          <div class="empty-icon">☕</div>
          <p>No items selected</p>
          <small>Choose coffee from the grid</small>
        </div>`;
      if (totalsEl) totalsEl.style.display = 'none';
      return;
    }

    if (totalsEl) totalsEl.style.display = '';

    itemsEl.innerHTML = lines.map(line => {
      const qty = line.unit === 'kg' ? line.quantity.toFixed(3) + ' kg'
                : line.unit === 'g'  ? line.quantity + ' g'
                :                      line.quantity + ' ' + line.unit;
      return `
        <div class="cart-line">
          <div class="cl-info">
            <div class="cl-name">${line.nameAr}</div>
            <div class="cl-detail mono">${qty} × EGP ${line.price.toLocaleString('en-EG')} / ${line.unit}</div>
          </div>
          <div class="cl-price">EGP ${line.lineTotal.toFixed(2)}</div>
          <button class="cl-remove" onclick="App.removeCartItem(${line.catalog_id})">✕</button>
        </div>`;
    }).join('');

    this._setText('totalWeight',   totals.totalKg.toFixed(3) + ' kg');
    this._setText('subtotalVal',   'EGP ' + totals.subtotal.toFixed(2));
    this._setText('taxVal',        'EGP ' + totals.taxAmount.toFixed(2));
    this._setText('grandVal',      'EGP ' + totals.grandTotal.toFixed(2));
    this._setText('taxPctDisplay', taxRate);
  }

  removeCartItem(catalogId) {
    Catalog.adjustQuantity(catalogId, -999_999);
  }

  // ── Save order ─────────────────────────────────────────────────

  async _saveOrder() {
    const name    = document.getElementById('custName')?.value.trim();
    const mobile  = document.getElementById('custMobile')?.value.trim();
    const address = document.getElementById('custAddr')?.value.trim();
    const notes   = document.getElementById('orderNotes')?.value.trim();
    const taxRate = parseFloat(document.getElementById('taxRate')?.value) || 20;
    const payment = document.querySelector('.pill.active')?.dataset.val || 'Cash';

    if (!name) {
      this.toast.show('Enter customer name', 'error');
      document.getElementById('custName')?.focus();
      return;
    }

    const lines = Catalog.getCartItems();
    if (!lines.length) {
      this.toast.show('Select at least one item', 'error');
      return;
    }

    const saveBtn  = document.getElementById('btnSaveOrder');
    const original = saveBtn?.textContent;
    if (saveBtn) saveBtn.textContent = '⏳ Saving to Sheets…';

    try {
      const result = await Sheets.saveOrder({
        customer: { name, mobile, address }, cart: lines, payment, notes, taxRate,
        presetName: this._activePresetName,
      });

      this.toast.show('✓ Saved — ' + result.invoice);

      this.receipt.show({
        invoice: result.invoice, date: result.date,
        custName: name, mobile, address, taxRate,
        subtotal: result.subtotal, taxAmount: result.tax_amount, grandTotal: result.total,
        totalKg: Catalog.getCartTotals(taxRate).totalKg, payment,
        presetName: this._activePresetName,
      });

      this.drawer.close();
      this._clearOrder(false);
      this._activePresetName = null;

    } catch (e) {
      this.toast.show('Save failed: ' + e.message, 'error');
    } finally {
      if (saveBtn) saveBtn.textContent = original;
    }
  }

  _clearOrder(notify = true) {
    Catalog.clearCart();
    this._activePresetName = null;
    ['custName', 'custMobile', 'custAddr', 'orderNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (notify) this.toast.show('Order cleared');
  }

  // ── Catalog: add item ──────────────────────────────────────────

  async _addCatalogItem() {
    const name_ar = document.getElementById('newItemNameAr')?.value.trim();
    const name_en = document.getElementById('newItemNameEn')?.value.trim();
    const type    = document.getElementById('newItemType')?.value;
    const price   = parseFloat(document.getElementById('newItemPrice')?.value);
    const unit    = document.getElementById('newItemUnit')?.value;
    const stockRaw = document.getElementById('newItemStock')?.value;
    const stock   = stockRaw?.trim() === '' ? '' : parseFloat(stockRaw);

    if (!name_ar) return this.toast.show('Arabic name required', 'error');
    if (!name_en) return this.toast.show('English name required', 'error');
    if (isNaN(price) || price < 0) return this.toast.show('Valid price required', 'error');

    try {
      await Sheets.addCatalogItem({ name_ar, name_en, type, price, unit, stock });
      ['newItemNameAr', 'newItemNameEn', 'newItemPrice', 'newItemStock'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      await Catalog.buildCatalogTable();
      await Catalog.load();
      this.toast.show('✓ Item added');
    } catch (e) {
      this.toast.show('Failed: ' + e.message, 'error');
    }
  }

  // ── Customers page ─────────────────────────────────────────────

  async _renderCustomersPage() {
    try {
      // Dashboard stats + charts + top customers now live on this page
      await this._renderDashboardCharts();

      const customers = await Sheets.getAllCustomers();
      const esc = ReceiptModal.escapeHtml;
      const fmt = ReceiptModal.formatDate;

      document.getElementById('customerTableBody').innerHTML = !customers.length
        ? `<tr><td colspan="8" class="table-empty">No customers yet</td></tr>`
        : customers.map(c => `
            <tr>
              <td><span class="badge badge-amber">${c.id}</span></td>
              <td>${esc(c.name)}</td>
              <td class="mono">${c.mobile || '—'}</td>
              <td class="muted" style="font-size:.8rem">${esc(c.address || '—')}</td>
              <td><span class="badge badge-teal">${c.order_count}</span></td>
              <td class="mono" style="color:var(--white)">EGP ${Number(c.total_spent).toFixed(2)}</td>
              <td class="mono muted" style="font-size:.75rem">${fmt(c.created_at?.split(' ')[0])}</td>
              <td><button class="btn btn-danger btn-sm" onclick="App.deleteCustomer(${c.id})">Delete</button></td>
            </tr>`).join('');

    } catch (e) {
      this.toast.show('Load failed: ' + e.message, 'error');
    }
  }

  // ── Orders page ────────────────────────────────────────────────

  // ── Dashboard (merged into the Customers page) ────────────────

  async _renderDashboardCharts() {
    try {
      const orders    = await Sheets.getAllOrders();
      const customers = await Sheets.getAllCustomers();

      const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
      const totalWeight  = orders.reduce((sum, o) => sum + (o.total_weight || 0), 0);
      const avgOrder     = orders.length ? totalRevenue / orders.length : 0;

      document.getElementById('dashboardStats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${orders.length}</div><div class="stat-label">Total Orders</div></div>
        <div class="stat-card"><div class="stat-value">EGP ${Math.round(totalRevenue).toLocaleString('en-EG')}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-value">${Number(totalWeight).toFixed(2)} kg</div><div class="stat-label">Coffee Sold</div></div>
        <div class="stat-card"><div class="stat-value">EGP ${Math.round(avgOrder).toLocaleString('en-EG')}</div><div class="stat-label">Avg / Order</div></div>`;

      // Build the last 14 days as YYYY-MM-DD, oldest first
      const days = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
      }

      const revenueByDay = days.map(day =>
        orders.filter(o => o.date === day).reduce((sum, o) => sum + o.total, 0)
      );
      const weightByDay = days.map(day =>
        orders.filter(o => o.date === day).reduce((sum, o) => sum + (o.total_weight || 0), 0)
      );

      const dayLabels = days.map(d => d.slice(5).replace('-', '/')); // MM/DD

      this._drawBarChart('revenueChart', revenueByDay, dayLabels, v => `${Math.round(v)}`);
      this._drawBarChart('weightChart',  weightByDay,  dayLabels, v => v.toFixed(1));

      // Top 5 customers by total spent
      const top = [...customers].sort((a, b) => b.total_spent - a.total_spent).slice(0, 5);
      const esc = ReceiptModal.escapeHtml;

      document.getElementById('topCustomersBody').innerHTML = !top.length
        ? `<tr><td colspan="4" class="table-empty">No customers yet</td></tr>`
        : top.map((c, i) => `
            <tr>
              <td><span class="badge badge-amber">${i + 1}</span></td>
              <td>${esc(c.name)}</td>
              <td><span class="badge badge-teal">${c.order_count}</span></td>
              <td class="mono" style="color:var(--white)">EGP ${Number(c.total_spent).toFixed(2)}</td>
            </tr>`).join('');

    } catch (e) {
      this.toast.show('Dashboard load failed: ' + e.message, 'error');
    }
  }

  /** Minimal dependency-free bar chart drawn straight onto a <canvas>. */
  _drawBarChart(canvasId, values, labels, formatValue) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Match the canvas's internal resolution to its displayed size (crisp on retina)
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    // Read the current theme's accent colour so the chart matches
    // dark mode (white bars) or light mode (black bars) automatically
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--white').trim() || '#ffffff';
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const dimBar   = isLight ? 'rgba(0,0,0,0.08)'  : 'rgba(255,255,255,0.08)';
    const dimLabel = isLight ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.7)';
    const axisLabel = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)';

    const max = Math.max(...values, 0.0001);
    const padding = { top: 20, bottom: 28, left: 8, right: 8 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;
    const barGap = 4;
    const barW = (chartW / values.length) - barGap;

    values.forEach((val, i) => {
      const barH = (val / max) * chartH;
      const x = padding.left + i * (barW + barGap);
      const y = padding.top + (chartH - barH);

      ctx.fillStyle = val > 0 ? accent : dimBar;
      ctx.fillRect(x, y, barW, barH);

      // Value label above the bar (only if it fits and is non-zero)
      if (val > 0 && barW > 14) {
        ctx.fillStyle = dimLabel;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(formatValue(val), x + barW / 2, y - 4);
      }

      // Day label below the axis (skip every other one on narrow screens)
      const showLabel = values.length <= 14 || i % 2 === 0;
      if (showLabel) {
        ctx.fillStyle = axisLabel;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], x + barW / 2, H - 10);
      }
    });
  }


  async _renderOrdersPage() {
    try {
      const orders  = await Sheets.getAllOrders();
      const revenue = orders.reduce((sum, o) => sum + o.total, 0);
      const weight  = orders.reduce((sum, o) => sum + (o.total_weight || 0), 0);

      document.getElementById('orderStats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${orders.length}</div><div class="stat-label">Orders</div></div>
        <div class="stat-card"><div class="stat-value">EGP ${Math.round(revenue).toLocaleString('en-EG')}</div><div class="stat-label">Revenue</div></div>
        <div class="stat-card"><div class="stat-value">${Number(weight).toFixed(2)} kg</div><div class="stat-label">Coffee Sold</div></div>`;

      const esc = ReceiptModal.escapeHtml;
      const fmt = ReceiptModal.formatDate;

      document.getElementById('orderTableBody').innerHTML = !orders.length
        ? `<tr><td colspan="8" class="table-empty">No orders yet</td></tr>`
        : orders.map(o => `
            <tr>
              <td><span class="badge badge-amber">${o.invoice}</span></td>
              <td class="muted">${fmt(o.date)}</td>
              <td>${esc(o.customer_name)}</td>
              <td class="mono">${Number(o.total_weight || 0).toFixed(3)} kg</td>
              <td class="mono" style="color:var(--white)">EGP ${Number(o.total).toFixed(2)}</td>
              <td><span class="badge badge-teal">${o.payment}</span></td>
              <td><button class="btn btn-teal btn-sm" onclick="App.viewOrderReceipt(${o.id})">Receipt</button></td>
              <td><button class="btn btn-danger btn-sm" onclick="App.deleteOrder(${o.id})">Delete</button></td>
            </tr>`).join('');

    } catch (e) {
      this.toast.show('Load failed: ' + e.message, 'error');
    }
  }

  /** Re-show the receipt for a past order (called from the Orders table). */
  async viewOrderReceipt(orderId) {
    try {
      const order  = await Sheets.getOrderDetails(orderId);
      const weight = (order.items || [])
        .filter(i => i.unit === 'kg')
        .reduce((sum, i) => sum + i.quantity, 0);

      this.receipt.show({
        invoice: order.invoice, date: order.date,
        custName: order.customer_name, mobile: order.mobile, address: order.address,
        taxRate: order.tax_rate, subtotal: order.subtotal, taxAmount: order.tax_amount,
        grandTotal: order.total, totalKg: weight, payment: order.payment,
        presetName: order.preset_name,
      });
    } catch (e) {
      this.toast.show('Receipt error: ' + e.message, 'error');
    }
  }

  /** Delete an order permanently (asks for confirmation first). */
  async deleteOrder(orderId) {
    if (!confirm('Delete this order permanently? This cannot be undone.')) return;
    try {
      await Sheets.deleteOrder(orderId);
      this.toast.show('✓ Order deleted');
      await this._renderOrdersPage();
    } catch (e) {
      this.toast.show('Delete failed: ' + e.message, 'error');
    }
  }

  /** Delete a customer permanently (their past orders remain as history). */
  async deleteCustomer(customerId) {
    if (!confirm('Delete this customer permanently? Their past orders will remain in history.')) return;
    try {
      await Sheets.deleteCustomer(customerId);
      this.toast.show('✓ Customer deleted');
      await this._renderCustomersPage();
    } catch (e) {
      this.toast.show('Delete failed: ' + e.message, 'error');
    }
  }

  // ── Small helper ───────────────────────────────────────────────

  _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // ── Presets Feature ──────────────────────────────────────────────

  async _renderPresets() {
    const grid = document.getElementById('presetsGrid');
    if (!grid) return;

    let presets = [];
    try {
      presets = await Sheets.getAllPresets();
    } catch (e) {
      grid.innerHTML = `<p class="presets-empty">Could not load presets: ${ReceiptModal.escapeHtml(e.message)}</p>`;
      return;
    }

    if (!presets.length) {
      grid.innerHTML = `<p class="presets-empty">No presets saved yet. Add items to the cart and save them above.</p>`;
      return;
    }

    grid.innerHTML = presets.map(preset => {
      const itemsDesc = preset.items.map(item => {
        const qty = item.unit === 'kg' ? Number(item.qty).toFixed(3) : item.qty;
        return `${item.name_en} (${qty} ${item.unit})`;
      }).join(' • ');

      return `
        <div class="preset-card">
          <div class="preset-card-header">
            <span class="preset-name">${ReceiptModal.escapeHtml(preset.name)}</span>
            <button class="preset-delete-btn" data-name="${ReceiptModal.escapeHtml(preset.name)}" aria-label="Delete preset">✕</button>
          </div>
          <div class="preset-items-list">${ReceiptModal.escapeHtml(itemsDesc)}</div>
          <button class="preset-apply-btn" data-name="${ReceiptModal.escapeHtml(preset.name)}">Apply Preset</button>
        </div>
      `;
    }).join('');
  }

  async _savePreset() {
    const nameEl = document.getElementById('presetName');
    const name = nameEl?.value.trim();
    if (!name) {
      this.toast.show('Enter preset name', 'error');
      nameEl?.focus();
      return;
    }

    const lines = Catalog.getCartItems();
    if (!lines.length) {
      this.toast.show('Select items / ingredients first', 'error');
      return;
    }

    const items = lines.map(line => ({
      id: line.catalog_id,
      name_ar: line.nameAr,
      name_en: line.nameEn,
      qty: line.quantity,
      unit: line.unit,
    }));

    try {
      const existing = (await Sheets.getAllPresets()).find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing && !confirm(`Overwrite existing preset "${name}"?`)) return;

      await Sheets.savePreset(name, items);
      if (nameEl) nameEl.value = '';

      this._activePresetName = name;
      await this._renderPresets();
      this.toast.show(`✓ Preset "${name}" saved`);
    } catch (e) {
      this.toast.show('Save failed: ' + e.message, 'error');
    }
  }

  async applyPreset(name) {
    try {
      const presets = await Sheets.getAllPresets();
      const preset  = presets.find(p => p.name === name);
      if (!preset) return;

      Catalog.clearCart();
      for (const item of preset.items) {
        Catalog.adjustQuantity(item.id, item.qty);
      }
      this._activePresetName = name;
      this.toast.show(`✓ Applied "${name}"`);
    } catch (e) {
      this.toast.show('Apply failed: ' + e.message, 'error');
    }
  }

  async deletePreset(name) {
    if (!confirm(`Delete preset "${name}"?`)) return;
    try {
      await Sheets.deletePreset(name);
      if (this._activePresetName === name) this._activePresetName = null;
      await this._renderPresets();
      this.toast.show(`✓ Preset "${name}" deleted`);
    } catch (e) {
      this.toast.show('Delete failed: ' + e.message, 'error');
    }
  }
}


// ── Single shared instance, boots on DOM ready ────────────────────────
const App = new AppController();

document.addEventListener('DOMContentLoaded', () => App.start());