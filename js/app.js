// js/app.js — Main Application Controller (Google Sheets backend)
'use strict';

const App = (() => {
  let _toastTimer = null;
  function toast(msg, type='success') {
    const el=document.getElementById('toastEl'); if(!el) return;
    if(_toastTimer) clearTimeout(_toastTimer);
    el.textContent=msg; el.className=`visible toast-${type}`;
    _toastTimer=setTimeout(()=>{ el.className=''; },3000);
  }
  return {
    toast,
    onCartChange() { _renderCart(); },
    _removeCartItem(id) { Catalog._adjust(id,-999999); },
    async _viewOrderReceipt(id) {
      try {
        const o=await Sheets.getOrderDetails(id);
        const kg=(o.items||[]).filter(i=>i.unit==='kg').reduce((s,i)=>s+i.quantity,0);
        _showReceipt({invoice:o.invoice,date:o.date,custName:o.customer_name,mobile:o.mobile,
          address:o.address,taxRate:o.tax_rate,subtotal:o.subtotal,taxAmount:o.tax_amount,
          grandTotal:o.total,totalKg:kg,payment:o.payment});
      } catch(e) { toast('Receipt error: '+e.message,'error'); }
    },
  };
})();

document.addEventListener('DOMContentLoaded', async () => {

  const setText=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  const esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'';
  const fmtDate=iso=>{ if(!iso)return'—'; const d=new Date(iso); return isNaN(d)?iso:d.toLocaleDateString('en-EG',{day:'2-digit',month:'short',year:'numeric'}); };

  // ── Show loading screen ────────────────────────────────────────
  _setLoading(true, 'Connecting to Google Sheets…');

  try {
    await Sheets.init();
    await Catalog.load();
    _wireEvents();
    _setLoading(false);

    const dateEl=document.getElementById('cartDate');
    if(dateEl) dateEl.textContent=new Date().toLocaleDateString('en-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    const badge=document.getElementById('invoiceBadge');
    if(badge) badge.textContent='FC-'+String(Date.now()).slice(-7);

    console.log('[App] Bahr Coffee Store POS ready.');
  } catch(err) {
    _setLoading(false);
    document.body.innerHTML=`
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                  background:#000;color:#fff;font-family:sans-serif;padding:2rem;text-align:center">
        <div style="font-size:3rem;margin-bottom:1rem">☕</div>
        <h2 style="color:#FF3B3B;margin-bottom:.75rem">Cannot connect to Google Sheets</h2>
        <p style="color:#888;margin-bottom:1rem">${esc(err.message)}</p>
        <p style="color:#555;font-size:.85rem">
          Make sure the Google Sheets API is enabled and the service account<br/>
          has Editor access to the spreadsheet.
        </p>
        <button onclick="location.reload()" style="margin-top:1.5rem;padding:.75rem 2rem;background:#fff;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:700">
          Try Again
        </button>
      </div>`;
  }

  function _setLoading(show, msg='') {
    let el=document.getElementById('loadingScreen');
    if(show) {
      if(!el) {
        el=document.createElement('div'); el.id='loadingScreen';
        el.style.cssText='position:fixed;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:1rem;font-family:sans-serif';
        el.innerHTML=`<div style="font-size:3rem">☕</div>
          <div style="color:#fff;font-size:1.1rem;font-weight:600">Bahr Coffee Store</div>
          <div id="loadingMsg" style="color:#888;font-size:.85rem">${msg}</div>
          <div style="width:200px;height:2px;background:#222;border-radius:1px;overflow:hidden;margin-top:.5rem">
            <div style="height:100%;background:#fff;animation:ldBar 1.5s ease-in-out infinite;width:40%"></div>
          </div>
          <style>@keyframes ldBar{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}</style>`;
        document.body.appendChild(el);
      } else { document.getElementById('loadingMsg').textContent=msg; }
    } else if(el) { el.remove(); }
  }

  // ── Events ────────────────────────────────────────────────────
  function _wireEvents() {
    document.querySelectorAll('.nav-btn,.bottom-nav-btn').forEach(b=>b.addEventListener('click',()=>_nav(b.dataset.page)));
    document.querySelectorAll('.pill').forEach(p=>p.addEventListener('click',()=>{
      document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active')); p.classList.add('active');
    }));
    document.getElementById('taxRate')?.addEventListener('input',_renderCart);
    document.getElementById('btnSaveOrder')?.addEventListener('click',_saveOrder);
    document.getElementById('btnClearOrder')?.addEventListener('click',()=>_clearOrder(true));
    document.getElementById('btnCloseModal')?.addEventListener('click',_closeModal);
    document.getElementById('btnCloseModal2')?.addEventListener('click',_closeModal);
    document.getElementById('receiptOverlay')?.addEventListener('click',e=>{ if(e.target===e.currentTarget)_closeModal(); });
    document.getElementById('btnAddItem')?.addEventListener('click',_addItem);
    document.getElementById('cartFab')?.addEventListener('click',_toggleDrawer);
    document.querySelectorAll('.export-csv-btn').forEach(b => b.addEventListener('click',()=>{ Sheets.exportToCSV(); App.toast('Downloading 3 CSV files…'); }));
    _wireSwipe();
  }

  // ── Navigation ───────────────────────────────────────────────
  function _nav(page) {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('page-'+page)?.classList.add('active');
    document.querySelectorAll('.nav-btn,.bottom-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    if(page!=='pos') _closeDrawer();
    if(page==='customers') _loadCustomers();
    if(page==='orders')    _loadOrders();
    if(page==='catalog')   Catalog.buildCatalogTable();
  }

  // ── Cart renderer ────────────────────────────────────────────
  function _renderCart() {
    const lines=Catalog.getCartItems(), taxRate=parseFloat(document.getElementById('taxRate')?.value)||14;
    const totals=Catalog.getCartTotals(taxRate);
    const itemsEl=document.getElementById('cartItems'), totalsEl=document.getElementById('cartTotals');
    const badge=document.getElementById('cartFabBadge');
    if(badge){badge.textContent=lines.length;badge.setAttribute('data-count',lines.length);}
    if(!lines.length){
      itemsEl.innerHTML=`<div class="cart-empty"><div class="empty-icon">☕</div><p>No items selected</p><small>Choose coffee from the grid</small></div>`;
      if(totalsEl) totalsEl.style.display='none'; return;
    }
    if(totalsEl) totalsEl.style.display='';
    itemsEl.innerHTML=lines.map(l=>{
      const q=l.unit==='kg'?l.quantity.toFixed(3)+' kg':l.unit==='g'?l.quantity+' g':l.quantity+' '+l.unit;
      return `<div class="cart-line">
        <div class="cl-info"><div class="cl-name">${l.nameAr}</div>
          <div class="cl-detail mono">${q} × EGP ${l.price.toLocaleString('en-EG')} / ${l.unit}</div></div>
        <div class="cl-price">EGP ${l.lineTotal.toFixed(2)}</div>
        <button class="cl-remove" onclick="App._removeCartItem(${l.catalog_id})">✕</button>
      </div>`;
    }).join('');
    setText('totalWeight',totals.totalKg.toFixed(3)+' kg');
    setText('subtotalVal','EGP '+totals.subtotal.toFixed(2));
    setText('taxVal','EGP '+totals.taxAmount.toFixed(2));
    setText('grandVal','EGP '+totals.grandTotal.toFixed(2));
    setText('taxPctDisplay',taxRate);
  }

  // ── Save order ───────────────────────────────────────────────
  async function _saveOrder() {
    const name=document.getElementById('custName')?.value.trim();
    const mobile=document.getElementById('custMobile')?.value.trim();
    const addr=document.getElementById('custAddr')?.value.trim();
    const notes=document.getElementById('orderNotes')?.value.trim();
    const taxRate=parseFloat(document.getElementById('taxRate')?.value)||14;
    const payment=document.querySelector('.pill.active')?.dataset.val||'Cash';
    if(!name){App.toast('Enter customer name','error');document.getElementById('custName')?.focus();return;}
    const lines=Catalog.getCartItems();
    if(!lines.length){App.toast('Select at least one item','error');return;}
    const btn=document.getElementById('btnSaveOrder'), orig=btn?.textContent;
    if(btn) btn.textContent='⏳ Saving to Sheets…';
    try {
      const r=await Sheets.saveOrder({customer:{name,mobile,address:addr},cart:lines,payment,notes,taxRate});
      App.toast('✓ Saved — '+r.invoice);
      _showReceipt({invoice:r.invoice,date:r.date,custName:name,mobile,address:addr,taxRate,
        subtotal:r.subtotal,taxAmount:r.tax_amount,grandTotal:r.total,
        totalKg:Catalog.getCartTotals(taxRate).totalKg,payment});
      _closeDrawer(); _clearOrder(false);
    } catch(e){App.toast('Save failed: '+e.message,'error');}
    finally{if(btn)btn.textContent=orig;}
  }

  // ── Receipt modal ────────────────────────────────────────────
  function _showReceipt({invoice,date,custName,mobile,address,taxRate,subtotal,taxAmount,grandTotal,totalKg,payment}) {
    document.getElementById('receiptContent').innerHTML=`
      <div class="rp-brand"><h2>Bahr Coffee Store</h2><div class="tagline">rise &amp; grind</div></div>
      <hr class="rp-divider"/>
      <div class="rp-info">
        <span class="rk">Invoice</span>  <span class="rv mono">${invoice}</span>
        <span class="rk">Date</span>     <span class="rv">${fmtDate(date)}</span>
        <span class="rk">Payment</span>  <span class="rv">${payment}</span>
      </div>
      <hr class="rp-divider"/>
      <div class="rp-info">
        <span class="rk">Customer</span> <span class="rv">${esc(custName)}</span>
        ${mobile?`<span class="rk">Mobile</span><span class="rv mono">${esc(mobile)}</span>`:''}
        ${address?`<span class="rk">Address</span><span class="rv">${esc(address).replace(/\n/g,'<br/>')}</span>`:''}
      </div>
      <hr class="rp-divider"/>
      <div class="rp-summary">
        <div class="rp-summary-row"><span class="sk">Total Weight</span><span class="sv mono">${Number(totalKg).toFixed(3)} kg</span></div>
        <div class="rp-summary-row"><span class="sk">Subtotal</span><span class="sv mono">EGP ${Number(subtotal).toFixed(2)}</span></div>
        <div class="rp-summary-row"><span class="sk">Tax (${taxRate}%)</span><span class="sv mono">EGP ${Number(taxAmount).toFixed(2)}</span></div>
        <div class="rp-summary-row final"><span class="sk">TOTAL DUE</span><span class="sv mono">EGP ${Number(grandTotal).toFixed(2)}</span></div>
      </div>
      <div class="rp-footer">☕ Thank you for choosing Bahr Coffee Store ☕<br/>Rise &amp; Grind — Every Cup Counts</div>`;
    document.getElementById('receiptOverlay')?.classList.add('open');
  }

  function _closeModal(){document.getElementById('receiptOverlay')?.classList.remove('open');}

  // ── Customers ────────────────────────────────────────────────
  async function _loadCustomers() {
    try {
      const list=await Sheets.getAllCustomers();
      const spent=list.reduce((s,c)=>s+c.total_spent,0), avg=list.length?spent/list.length:0;
      document.getElementById('customerStats').innerHTML=`
        <div class="stat-card"><div class="stat-value">${list.length}</div><div class="stat-label">Customers</div></div>
        <div class="stat-card"><div class="stat-value">EGP ${Math.round(spent).toLocaleString('en-EG')}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-value">EGP ${Math.round(avg).toLocaleString('en-EG')}</div><div class="stat-label">Avg / Customer</div></div>`;
      document.getElementById('customerTableBody').innerHTML=!list.length
        ?`<tr><td colspan="7" class="table-empty">No customers yet</td></tr>`
        :list.map(c=>`<tr>
            <td><span class="badge badge-amber">${c.id}</span></td>
            <td>${esc(c.name)}</td><td class="mono">${c.mobile||'—'}</td>
            <td class="muted" style="font-size:.8rem">${esc(c.address||'—')}</td>
            <td><span class="badge badge-teal">${c.order_count}</span></td>
            <td class="mono" style="color:var(--white)">EGP ${Number(c.total_spent).toFixed(2)}</td>
            <td class="mono muted" style="font-size:.75rem">${fmtDate(c.created_at?.split(' ')[0])}</td>
          </tr>`).join('');
    } catch(e){App.toast('Load failed: '+e.message,'error');}
  }

  // ── Orders ───────────────────────────────────────────────────
  async function _loadOrders() {
    try {
      const list=await Sheets.getAllOrders();
      const rev=list.reduce((s,o)=>s+o.total,0), kg=list.reduce((s,o)=>s+(o.total_weight||0),0);
      document.getElementById('orderStats').innerHTML=`
        <div class="stat-card"><div class="stat-value">${list.length}</div><div class="stat-label">Orders</div></div>
        <div class="stat-card"><div class="stat-value">EGP ${Math.round(rev).toLocaleString('en-EG')}</div><div class="stat-label">Revenue</div></div>
        <div class="stat-card"><div class="stat-value">${Number(kg).toFixed(2)} kg</div><div class="stat-label">Coffee Sold</div></div>`;
      document.getElementById('orderTableBody').innerHTML=!list.length
        ?`<tr><td colspan="7" class="table-empty">No orders yet</td></tr>`
        :list.map(o=>`<tr>
            <td><span class="badge badge-amber">${o.invoice}</span></td>
            <td class="muted">${fmtDate(o.date)}</td><td>${esc(o.customer_name)}</td>
            <td class="mono">${Number(o.total_weight||0).toFixed(3)} kg</td>
            <td class="mono" style="color:var(--white)">EGP ${Number(o.total).toFixed(2)}</td>
            <td><span class="badge badge-teal">${o.payment}</span></td>
            <td><button class="btn btn-teal btn-sm" onclick="App._viewOrderReceipt(${o.id})">Receipt</button></td>
          </tr>`).join('');
    } catch(e){App.toast('Load failed: '+e.message,'error');}
  }

  // ── Add catalog item ─────────────────────────────────────────
  async function _addItem() {
    const name_ar=document.getElementById('newItemNameAr')?.value.trim();
    const name_en=document.getElementById('newItemNameEn')?.value.trim();
    const type=document.getElementById('newItemType')?.value;
    const price=parseFloat(document.getElementById('newItemPrice')?.value);
    const unit=document.getElementById('newItemUnit')?.value;
    if(!name_ar){App.toast('Arabic name required','error');return;}
    if(!name_en){App.toast('English name required','error');return;}
    if(isNaN(price)||price<0){App.toast('Valid price required','error');return;}
    try {
      await Sheets.addCatalogItem({name_ar,name_en,type,price,unit});
      ['newItemNameAr','newItemNameEn','newItemPrice'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      await Catalog.buildCatalogTable(); await Catalog.load();
      App.toast('✓ Item added');
    } catch(e){App.toast('Failed: '+e.message,'error');}
  }

  function _clearOrder(notify=true) {
    Catalog.clearCart();
    ['custName','custMobile','custAddr','orderNotes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    if(notify) App.toast('Order cleared');
  }

  // ── Mobile drawer ────────────────────────────────────────────
  function _openDrawer() {
    const pos=document.getElementById('page-pos'); pos?.classList.add('cart-open');
    if(pos&&!pos.querySelector('.cart-drawer-overlay')){
      const ov=document.createElement('div'); ov.className='cart-drawer-overlay';
      ov.addEventListener('click',_closeDrawer); pos.appendChild(ov);
    }
  }
  function _closeDrawer(){document.getElementById('page-pos')?.classList.remove('cart-open');}
  function _toggleDrawer(){document.getElementById('page-pos')?.classList.contains('cart-open')?_closeDrawer():_openDrawer();}
  function _wireSwipe() {
    const panel=document.querySelector('.pos-right'); if(!panel) return;
    let sy=0,active=false;
    panel.addEventListener('touchstart',e=>{sy=e.touches[0].clientY;active=true;},{passive:true});
    panel.addEventListener('touchmove',e=>{if(!active)return;const d=e.touches[0].clientY-sy;if(d>0&&panel.scrollTop===0)panel.style.transform=`translateY(${Math.min(d*.4,60)}px)`;},{passive:true});
    panel.addEventListener('touchend',e=>{if(!active)return;active=false;panel.style.transform='';if(e.changedTouches[0].clientY-sy>80)_closeDrawer();});
  }
});
