(() => {
  const API = '/api/v1';
  const storeId = 'saathi-kirana';
  const categories = ['All', 'Vegetables', 'Dairy', 'Staples', 'Snacks'];
  const artGlyph = { veg: '♧', dairy: '♜', staple: '▱', snack: '▣' };
  const money = minor => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(minor || 0) / 100);
  const $ = id => document.getElementById(id);
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { user: null, mode: location.pathname === '/seller' ? 'seller' : 'shopper', store: null, stores: [], sellerStores: [], selectedStoreId: '', demoAvailable: true, products: [], allProducts: [], slots: [], orders: [], savedProducts: [], profile: null, category: 'All', search: '', slotId: '', basket: {}, quotePrices: {}, settings: null, loading: false, poll: null, inStockOnly: false, minPrice: '', maxPrice: '', sort: '', queueSearch: '', queueDate: '', queueStatus: '' };
  let toastTimer;
  function showToast(message) {
    const node = $('toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }
  function showNotice(message) {
    const notice = $('globalNotice'); notice.textContent = message; notice.hidden = false;
  }
  function clearNotice() { $('globalNotice').hidden = true; $('globalNotice').textContent = ''; }
  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options, credentials: 'same-origin',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || 'Something went wrong.');
      error.status = response.status; error.code = payload.code || 'REQUEST_FAILED'; error.details = payload.details;
      throw error;
    }
    return payload;
  }
  function basketKey() { return `kc-basket:${state.user?.id || 'anonymous'}:${state.store?.id || state.selectedStoreId || storeId}`; }
  function quoteKey(){return `${basketKey()}:quotes`;}
  function loadBasket() {
    try { state.basket = JSON.parse(localStorage.getItem(basketKey()) || '{}') || {};state.quotePrices=JSON.parse(localStorage.getItem(quoteKey())||'{}')||{}; }
    catch { state.basket = {};state.quotePrices={}; }
  }
  function saveBasket() {
    try { localStorage.setItem(basketKey(), JSON.stringify(state.basket));localStorage.setItem(quoteKey(),JSON.stringify(state.quotePrices)); }
    catch { showToast('This browser could not save your basket for a refresh.'); }
  }
  function makeRequestKey() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function getRequestKey() {
    const signature = JSON.stringify({ store_id: state.store?.id || storeId, slot_id: state.slotId, items: basketLines().map(line => [line.product.id, line.qty]) });
    try {
      const saved = JSON.parse(sessionStorage.getItem('kc-order-attempt') || 'null');
      if (saved?.signature === signature && saved.key) return saved.key;
      const key = makeRequestKey(); sessionStorage.setItem('kc-order-attempt', JSON.stringify({ signature, key })); return key;
    } catch { return makeRequestKey(); }
  }
  function clearRequestKey() { try { sessionStorage.removeItem('kc-order-attempt'); } catch {} }
  function basketLines() {
    return Object.entries(state.basket).map(([id, qty]) => ({ product: (state.allProducts||[]).find(p => p.id === id)||state.products.find(p => p.id === id), qty: Number(qty) }))
      .filter(line => line.product && line.qty > 0);
  }
  function basketCount() { return basketLines().reduce((sum, line) => sum + line.qty, 0); }
  function basketTotal() { return basketLines().reduce((sum, line) => sum + line.qty * line.product.price_minor, 0); }
  function statusText(status) {
    return ({ placed: 'Waiting for the shop', packing: 'Being packed', ready: 'Ready for pickup', collected: 'Picked up', cancelled: 'Cancelled' })[status] || status;
  }
  function productIcon(product) { return artGlyph[product.art] || '▦'; }
  function renderRole() {
    const isSeller = state.mode === 'seller';
    $('shopperSignIn').hidden = state.demoAvailable === false;
    $('sellerSignIn').hidden = state.demoAvailable === false;
    if (!state.user && state.demoAvailable === false) showNotice('Sample sign-in is disabled here. Real account sign-in has not been set up.');
    $('customerView').hidden = isSeller;
    $('sellerView').hidden = !state.user || !isSeller;
    $('signInPanel').hidden = Boolean(state.user);
    $('roleNav').hidden = !state.user;
    $('signOutButton').hidden = !state.user;
    $('customerLink').classList.toggle('active', !isSeller);
    $('sellerLink').classList.toggle('active', isSeller);
    $('pageIntro').textContent = isSeller
      ? 'Manage your sample catalogue, keep stock current, and pack orders for pickup.'
      : 'Order from a neighbourhood shop’s shelf stock. The shop packs one labeled bag for your chosen pickup time.';
    $('storeName').textContent = state.store?.name || 'Saathi Kirana';
    $('storeLocation').textContent = state.store?.neighborhood || 'Sample neighbourhood';
    $('storeCaption').textContent = `Pickup from ${state.store?.pickup_location || 'the shop counter'} · ${state.store?.time_zone || 'shop local time'}`;
    $('sellerTitle').textContent = `Today at ${state.store?.name || 'Saathi Kirana'}`;
    const storeChoices = state.stores || [];
    $('storeSelectWrap').hidden = isSeller;
    $('storeSelect').innerHTML = storeChoices.map(store => `<option value="${html(store.id)}" ${store.id === state.store?.id ? 'selected' : ''}>${html(store.name)} · ${html(store.neighborhood)}</option>`).join('');
    $('storeSearch').value ||= '';
    $('slotZone').textContent = `${state.store?.is_open ? 'Open for pickup' : 'Currently closed'} · ${state.store?.time_zone || 'shop local time'}`;
    $('sellerStoreSelect').innerHTML = (state.sellerStores||[]).map(store=>`<option value="${html(store.id)}" ${store.id===state.store?.id?'selected':''}>${html(store.name)} · ${html(store.neighborhood)}</option>`).join('');
    $('toggleStoreOpen').textContent = state.store?.is_open ? 'Close shop' : 'Open shop';
    if(state.store&&!$('pickupLocationInput').matches(':focus'))$('pickupLocationInput').value=state.store.pickup_location||'';
  }
  function renderCategories() {
    $('categoryRow').innerHTML = categories.map(category => `<button class="category-button" type="button" data-category="${html(category)}" aria-pressed="${state.category === category}">${html(category)}</button>`).join('');
  }
  function renderProducts() {
    const query = state.search.trim().toLowerCase();
    let filtered = state.products.filter(product => (state.category === 'All' || product.category === state.category) &&
      (!query || `${product.name} ${product.category} ${product.description||''}`.toLowerCase().includes(query)) &&
      (!state.inStockOnly || product.available > 0) &&
      (state.minPrice === '' || product.price_minor >= Number(state.minPrice) * 100) &&
      (state.maxPrice === '' || product.price_minor <= Number(state.maxPrice) * 100));
    if (state.sort === 'price_asc') filtered = [...filtered].sort((a,b)=>a.price_minor-b.price_minor);
    else if (state.sort === 'price_desc') filtered = [...filtered].sort((a,b)=>b.price_minor-a.price_minor);
    else if (state.sort === 'name') filtered = [...filtered].sort((a,b)=>a.name.localeCompare(b.name));
    $('productGrid').innerHTML = filtered.length ? filtered.map(product => {
      const qty = Number(state.basket[product.id] || 0); const available = product.available > 0;
      const pill = available ? `${product.available} on shelf` : 'Sold out';
      const stockClass = !available ? 'out' : product.available <= 3 ? 'low' : '';
      const saved = state.savedProducts.some(item => item.product_id === product.id);
      const control = qty ? `<div class="qty-control" aria-label="${html(product.name)} quantity"><button type="button" data-action="minus" data-id="${html(product.id)}" aria-label="Remove one ${html(product.name)}">−</button><output>${qty}</output><button type="button" data-action="plus" data-id="${html(product.id)}" aria-label="Add one ${html(product.name)}" ${qty >= product.available ? 'disabled' : ''}>+</button></div>`
        : `<button class="add-button" type="button" data-action="add" data-id="${html(product.id)}" ${!available ? 'disabled' : ''}>${available ? 'Add +' : 'Unavailable'}</button>`;
      return `<article class="product-card"><div class="product-top"><button class="product-art art-${html(product.art)}" type="button" data-detail="${html(product.id)}" aria-label="View ${html(product.name)} details">${productIcon(product)}</button><span class="stock-pill ${stockClass}">${pill}</span></div><div class="product-info"><h3 class="product-name">${html(product.name)}</h3><div class="product-unit">${html(product.unit)} · ${html(product.category)}</div><div class="product-bottom"><div class="price">${money(product.price_minor)}<span class="price-note">pay at store</span></div>${control}</div><div class="product-tools"><button type="button" data-detail="${html(product.id)}">Details</button><button type="button" data-save="${html(product.id)}">${saved ? '♥ Saved' : '♡ Save'}</button></div></div></article>`;
    }).join('') : '<div class="empty-state">No shelf items match. Try another search or category.</div>';
  }
  function renderBasket() {
    const lines = basketLines(); $('basketCount').textContent = String(basketCount());
    if (!lines.length) {
      $('basketContent').innerHTML = '<div class="basket-empty"><strong>Your basket is waiting</strong>Add some shelf items, then choose an evening pickup time.</div>' + renderSlots() + renderTotals();
      return;
    }
    const stale = lines.some(({ product, qty }) => qty > product.available);
    const priceChanged=lines.some(({product})=>state.quotePrices[product.id]&&Number(state.quotePrices[product.id])!==product.price_minor);
    const priceNote=({product})=>state.quotePrices[product.id]&&Number(state.quotePrices[product.id])!==product.price_minor?`<div class="basket-item-meta">Price changed from ${money(state.quotePrices[product.id])} to ${money(product.price_minor)} each</div>`:'';
    const contents = lines.map(({ product, qty }) => `<div class="basket-line"><div><div class="basket-item-name">${html(product.name)} × ${qty}</div><div class="basket-item-meta">${html(product.unit)} · ${product.available} currently available</div>${priceNote({product})}</div><div class="basket-item-total">${money(product.price_minor * qty)}</div></div>`).join('');
    const warning = stale ? '<p class="cart-warning">Shelf stock changed. Reduce the marked quantities before placing this order.</p>' : priceChanged ? '<p class="cart-warning">One or more prices changed. Review the updated total before placing the order.</p>' : '';
    $('basketContent').innerHTML = `${contents}${warning}${renderSlots()}${renderTotals()}<button class="primary-button checkout-button" id="placeOrder" type="button" ${!state.slotId || state.loading || stale ? 'disabled' : ''}>${state.loading ? 'Placing order…' : 'Place pickup order'}</button><p class="fine-print">No online payment · pay at the shop</p>`;
  }
  function renderSlots() {
    const slots = state.slots || [];
    const today = state.store?.local_date || state.selectedDate || new Date().toISOString().slice(0, 10);
    const tomorrow = nextDate(today);
    const emptyMessage = state.selectedDate === today ? 'No bookable slots are left today. Try tomorrow.' : 'No bookable slots on this date. Try today.';
    const slotContent = slots.length ? `<div class="slot-list">${slots.map(slot => `<button class="slot-button" type="button" data-slot="${html(slot.id)}" aria-pressed="${state.slotId === slot.id}" ${slot.remaining < 1 ? 'disabled' : ''}>${html(slot.label)}<br><small>${slot.remaining} spot${slot.remaining === 1 ? '' : 's'}</small></button>`).join('')}</div>` : `<p class="slot-empty">${emptyMessage}</p>`;
    return `<div class="slot-section"><div class="date-switch"><button class="date-button" type="button" data-pickup-date="${html(today)}" aria-pressed="${state.selectedDate === today}">Today</button><button class="date-button" type="button" data-pickup-date="${html(tomorrow)}" aria-pressed="${state.selectedDate === tomorrow}">Tomorrow</button></div><div class="slot-heading"><strong>Choose a pickup time</strong><span>${html(state.store?.time_zone || '')}</span></div>${slotContent}</div>`;
  }
  function renderTotals() {
    return `<div class="total-row"><span>Estimated basket total<small>Sample prices · pay at store</small></span><span>${money(basketTotal())}</span></div>`;
  }
  function renderTimeline(status) {
    const steps = [{ key: 'placed', label: 'Placed' }, { key: 'packing', label: 'Packing' }, { key: 'ready', label: 'Ready' }, { key: 'collected', label: 'Picked up' }];
    const current = steps.findIndex(step => step.key === status);
    return `<div class="order-timeline">${steps.map((step, i) => `<div class="timeline-step ${status !== 'cancelled' && i <= current ? 'done' : ''}">${step.label}</div>`).join('')}</div>`;
  }
  function renderCustomerOrders() {
    const orders = state.orders || [];
    if (!orders.length) { $('customerOrders').innerHTML = '<div class="empty-state">Your orders will show here after you place one.</div>'; return; }
    $('customerOrders').innerHTML = orders.map(order => {
      const items = order.items.map(item => `<div class="basket-line"><div><div class="basket-item-name">${html(item.name)} × ${item.quantity}</div><div class="basket-item-meta">${html(item.unit)} · ${money(item.price_minor)} each</div></div><div class="basket-item-total">${money(item.price_minor * item.quantity)}</div></div>`).join('');
      const code = order.pickup_code ? `<div class="pickup-code"><span class="detail-label">Show this pickup code to the shopkeeper</span><strong>${html(order.pickup_code)}</strong></div>` : '';
      const cancel = order.status === 'placed' ? `<div class="order-actions"><button class="small-button danger" type="button" data-cancel="${html(order.id)}">Cancel before packing</button></div>` : '';
      const reorder = order.status !== 'cancelled' ? `<button class="small-button secondary" type="button" data-reorder="${html(order.id)}">Shop again</button>` : '';
      const slot = `${new Date(order.pickup_starts_at).toLocaleDateString('en-IN', { timeZone: order.time_zone, weekday: 'short', day: 'numeric', month: 'short' })} · ${html(order.pickup_slot_label)}`;
      return `<article class="order-card"><div class="order-banner"><div><div class="order-label-caption">Pickup reference</div><div class="order-label">${html(order.public_label)}</div></div><span class="status-chip ${html(order.status)}"><i></i>${html(statusText(order.status))}</span></div><div class="order-content"><div><div class="detail-label">Pickup time</div><div class="detail-value">${slot}</div><div class="detail-label pickup-point-label">Pickup point</div><div class="detail-value">${html(order.pickup_location)}</div><div class="bag-label">▧ One bag · ${html(order.bag_label)}</div>${code}</div><div><div class="detail-label">Order contents</div><div class="order-items">${items}</div><div class="total-row"><span>Total · pay at store</span><span>${money(order.total_minor)}</span></div></div>${renderTimeline(order.status)}<div class="order-actions">${reorder}${cancel}</div></div></article>`;
    }).join('');
  }
  function renderSavedProducts() {
    const items=state.savedProducts||[];
    $('savedProducts').innerHTML=items.length?items.map(item=>`<div class="saved-item"><span>${html(item.name)} · ${html(item.unit)} · ${money(item.price_minor)}</span><span><button class="small-button secondary" type="button" data-save-add="${html(item.product_id)}">Add</button><button class="small-button danger" type="button" data-unsave="${html(item.product_id)}">Remove</button></span></div>`).join(''):'<div class="empty-state">Saved items will appear here.</div>';
  }
  function renderProfile() {
    const form=$('profileForm');if(!state.profile)return;
    if(form.dataset.loaded!=='yes'){form.elements.display_name.value=state.profile.display_name||'';form.dataset.loaded='yes';}
  }
  function renderInventory() {
    if (!state.products.length) { $('inventoryList').innerHTML = '<div class="queue-empty"><strong>No shelf items yet</strong>Add the first item above to show it to shoppers.</div>'; return; }
    $('inventoryList').innerHTML = state.products.map(product => `<div class="inventory-row"><div class="inventory-product"><div class="inventory-art" aria-hidden="true">${productIcon(product)}</div><div><div class="inventory-name">${html(product.name)} ${product.active ? '' : '<span class="stock-pill out">Hidden</span>'}</div><div class="inventory-unit">${html(product.unit)} · ${html(product.category)} · ${money(product.price_minor)}</div><div class="inventory-unit">${product.available} available · ${product.reserved} reserved</div></div></div><div class="stock-controls"><button type="button" data-stock="down" data-id="${html(product.id)}" aria-label="Reduce ${html(product.name)} shelf count" ${product.on_hand <= product.reserved ? 'disabled' : ''}>−</button><output>${product.on_hand}</output><button type="button" data-stock="up" data-id="${html(product.id)}" aria-label="Increase ${html(product.name)} shelf count" ${product.on_hand >= 9999 ? 'disabled' : ''}>+</button><button type="button" data-active="${html(product.id)}" aria-label="${product.active ? 'Hide' : 'Show'} ${html(product.name)}">${product.active ? 'Hide' : 'Show'}</button></div><details class="inventory-edit"><summary>Edit item details</summary><form class="edit-product-form" data-edit-product="${html(product.id)}"><label>Item name<input name="name" maxlength="50" value="${html(product.name)}" required></label><label>Pack / unit<input name="unit" maxlength="24" value="${html(product.unit)}" required></label><label>Category<select name="category">${categories.slice(1).map(category => `<option value="${category}" ${category === product.category ? 'selected' : ''}>${category}</option>`).join('')}</select></label><label>Price (₹)<input name="price" type="number" min="0.01" max="100000" step="0.01" value="${(product.price_minor / 100).toFixed(2)}" required></label><button class="small-button" type="submit">Save item details</button></form></details></div>`).join('');
  }
  function sellerOrderCard(order) {
    const items = order.items.map(item => `<div class="seller-order-item"><span>${html(item.name)} · ${html(item.unit)}</span><strong>× ${item.quantity}</strong></div>`).join('');
    const slot = `${new Date(order.pickup_starts_at).toLocaleDateString('en-IN', { timeZone: order.time_zone, weekday: 'short', day: 'numeric', month: 'short' })} · ${html(order.pickup_slot_label)}`;
    let actions = '';
    if (order.status === 'placed') actions = `<button class="small-button" type="button" data-start-packing="${html(order.id)}">Start packing</button><button class="small-button danger" type="button" data-seller-cancel="${html(order.id)}">Cancel order</button>`;
    if (order.status === 'packing') actions = `<button class="small-button" type="button" data-mark-ready="${html(order.id)}">Seal bag &amp; mark ready</button>`;
    if (order.status === 'ready') actions = `<form class="pickup-form" data-complete="${html(order.id)}"><label class="pickup-code-label">Shopper pickup code<input name="pickup_code" autocomplete="one-time-code" minlength="8" maxlength="8" placeholder="Enter 8-character code" aria-label="Shopper pickup code" required></label><button class="small-button" type="submit">Verify &amp; hand over</button></form>`;
    if (order.status === 'collected') actions = '<button class="small-button secondary" type="button" disabled>Pickup complete</button>';
    if (order.status === 'cancelled') actions = '<button class="small-button secondary" type="button" disabled>Cancelled</button>';
    return `<article class="seller-order"><div class="seller-order-top"><div><strong>${html(order.public_label)} · ${slot}</strong><small>${html(order.bag_label)} · ${html(order.pickup_location)}</small></div><span class="status-chip ${html(order.status)}"><i></i>${html(statusText(order.status))}</span></div><div class="seller-order-body"><div class="detail-label">${order.items.reduce((sum,item)=>sum+item.quantity,0)} units · ${money(order.total_minor)} · pay at shop</div>${items}<div class="seller-actions">${actions}</div></div></article>`;
  }
  function renderSellerOrders() {
    const activeCount = state.orders.filter(order => ['placed', 'packing', 'ready'].includes(order.status)).length;
    $('queueCount').textContent = String(activeCount);
    $('sellerOrders').innerHTML = state.orders.length ? state.orders.map(sellerOrderCard).join('') : '<div class="queue-empty"><strong>No pickup baskets yet</strong>Orders will appear here after a shopper checks out.</div>';
  }
  function renderSettings() {
    const form = $('settingsForm'); if (!state.settings || form.dataset.loaded === 'yes') return;
    for (const name of ['evening_start', 'evening_end', 'capacity', 'cutoff_minutes']) form.elements[name].value = state.settings[name];
    for(const checkbox of form.querySelectorAll('[name=service_days]'))checkbox.checked=state.settings.service_days.includes(Number(checkbox.value));
    form.elements.closure_dates.value=(state.settings.closure_dates||[]).join(', ');
    form.dataset.loaded = 'yes';
  }
  function renderAll() {
    renderRole();
    if(state.mode==='seller'){if(state.user){renderInventory();renderSellerOrders();renderSettings();}return;}
    renderCategories();renderProducts();renderBasket();
    if(state.user){renderCustomerOrders();renderSavedProducts();renderProfile();}
  }
  async function refreshData({quiet = false} = {}) {
    try {
      clearNotice();
      const storeResult=await api(`/stores?q=${encodeURIComponent($('storeSearch').value||'')}`);
      state.stores=storeResult.stores;
      if(state.user&&state.mode==='seller'){
        const authorized=await api('/seller/stores');state.sellerStores=authorized.stores;
        if(!state.sellerStores.length)throw new Error('This shopkeeper account has no shop assigned.');
        if(!state.sellerStores.some(store=>store.id===(state.selectedStoreId||storeId)))state.selectedStoreId=state.sellerStores[0].id;
      }
      state.store=state.stores.find(store=>store.id===(state.selectedStoreId||storeId))||state.stores[0]||null;
      if(!state.store){state.products=[];state.slots=[];state.orders=[];renderAll();return;}
      state.selectedStoreId=state.store.id;
      if(!state.user){
        const date=state.selectedDate||state.store.local_date;state.selectedDate=date;
        const [allProducts,products,slots]=await Promise.all([
          api(`/stores/${encodeURIComponent(state.store.id)}/products`),
          api(`/stores/${encodeURIComponent(state.store.id)}/products${catalogQuery()}`),
          api(`/stores/${encodeURIComponent(state.store.id)}/pickup-slots?date=${encodeURIComponent(date)}`)
        ]);
        state.allProducts=allProducts.products;state.products=products.products;state.slots=slots.slots;state.orders=[];loadBasket();for(const item of state.allProducts)if(state.basket[item.id]&&!state.quotePrices[item.id])state.quotePrices[item.id]=item.price_minor;saveBasket();renderAll();return;
      }
      if(state.mode==='seller'){
        const [products,orders,settings]=await Promise.all([
          api(`/seller/stores/${encodeURIComponent(state.store.id)}/products`),
          api(sellerQueueUrl()),
          api(`/seller/stores/${encodeURIComponent(state.store.id)}/pickup-settings`)
        ]);
        state.products=products.products;state.orders=orders.orders;state.settings=settings.settings;
      }else{
        const date=state.selectedDate||state.store.local_date;state.selectedDate=date;
        const [allProducts,products,slots,orders,basket,profile,saved]=await Promise.all([
          api(`/stores/${encodeURIComponent(state.store.id)}/products`),
          api(`/stores/${encodeURIComponent(state.store.id)}/products${catalogQuery()}`),
          api(`/stores/${encodeURIComponent(state.store.id)}/pickup-slots?date=${encodeURIComponent(date)}`),
          api('/shopper/me/orders'),api('/shopper/basket'),api('/shopper/me'),api('/shopper/me/saved-products')
        ]);
        state.allProducts=allProducts.products;state.products=products.products;state.slots=slots.slots;state.orders=orders.orders;
        state.profile=profile.profile;state.savedProducts=saved.products;
        if(basket.basket.store_id===state.store.id){state.basket=Object.fromEntries(basket.basket.items.map(item=>[item.product_id,item.quantity]));state.quotePrices=Object.fromEntries(basket.basket.items.map(item=>[item.product_id,item.quoted_price_minor]));saveBasket();}
        if(state.slotId&&!state.slots.some(slot=>slot.id===state.slotId))state.slotId='';
        for(const id of Object.keys(state.basket)){
          const product=state.products.find(item=>item.id===id);
          if(!product||!product.active)delete state.basket[id];
        }
        saveBasket();
      }
      renderAll();
    }catch(error){
      if(error.status===401){state.user=null;renderAll();}
      else if(!quiet)showNotice(`${error.message} Use Refresh to try again.`);
    }
  }
  function catalogQuery(){
    const params=new URLSearchParams();
    if(state.search)params.set('q',state.search);
    if(state.category!=='All')params.set('category',state.category);
    if(state.inStockOnly)params.set('in_stock','true');
    if(state.minPrice!=='')params.set('min_price',state.minPrice);
    if(state.maxPrice!=='')params.set('max_price',state.maxPrice);
    if(state.sort)params.set('sort',state.sort);
    return params.size?`?${params.toString()}`:'';
  }
  function sellerQueueUrl(){
    const params=new URLSearchParams();
    if(state.queueSearch)params.set('q',state.queueSearch);
    if(state.queueDate)params.set('date',state.queueDate);
    if(state.queueStatus)params.set('status',state.queueStatus);
    return `/seller/stores/${encodeURIComponent(state.store.id)}/orders${params.size?`?${params.toString()}`:''}`;
  }
  async function syncBasket(){
    if(!state.user||state.mode!=='shopper'||!state.store)return;
    try{await api('/shopper/basket',{method:'PUT',body:JSON.stringify({store_id:state.store.id,items:Object.entries(state.basket).map(([product_id,quantity])=>({product_id,quantity,expected_price_minor:state.quotePrices[product_id]}))})});}
    catch(error){showNotice(error.message);}
  }
  async function signIn(role) {
    try {
      const result = await api('/auth/demo', { method: 'POST', body: JSON.stringify({ role }) });
      const guestBasket={...state.basket};
      state.user = result.user; state.mode = role;
      state.category = 'All'; state.search = ''; state.selectedDate = undefined; state.slotId = '';
      $('searchInput').value = ''; state.basket=guestBasket;
      if(role==='shopper'&&state.store&&Object.keys(guestBasket).length)await syncBasket();
      history.replaceState({}, '', role === 'seller' ? '/seller' : '/customer');
      await refreshData();
      showToast(`Signed in to the sample ${role === 'seller' ? 'shopkeeper' : 'shopper'} account.`);
      startPolling();
    } catch (error) { showNotice(error.message); }
  }
  async function signOut() {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    state.user = null; state.orders = []; state.profile=null; state.savedProducts=[]; stopPolling();
    state.mode='shopper';history.replaceState({}, '', '/customer');await refreshData();renderAll();
  }
  function startPolling() { stopPolling(); state.poll = setInterval(() => refreshData({ quiet: true }), 5000); }
  function stopPolling() { if (state.poll) clearInterval(state.poll); state.poll = null; }
  function changeQty(id, delta) {
    const product = (state.allProducts||[]).find(item => item.id === id)||state.products.find(item => item.id === id); if (!product) return;
    const next = Number(state.basket[id] || 0) + delta;
    if (next < 1) {delete state.basket[id];delete state.quotePrices[id];}
    else if (next > product.available) { showToast(`Only ${product.available} ${product.name} on the shelf.`); return; }
    else {if(!state.basket[id])state.quotePrices[id]=product.price_minor;state.basket[id] = next;}
    state.slotId = state.slots.some(slot => slot.id === state.slotId) ? state.slotId : '';
    clearRequestKey(); saveBasket(); renderProducts(); renderBasket(); void syncBasket();
  }
  async function placeOrder() {
    const lines = basketLines();
    if (!lines.length || !state.slotId) { showToast('Add an item and choose a pickup time first.'); return; }
    if(!state.user){showNotice('Choose the shopper account to sign in before placing your pickup order.');return;}
    if(state.store&&!state.store.is_open){showNotice('This shop is closed right now. You can still browse, then choose an open shop or return when it reopens.');return;}
    const slot=state.slots.find(item=>item.id===state.slotId);
    const review=`Shop: ${state.store?.name}\nPickup: ${slot?`${state.selectedDate} · ${slot.label}`:'chosen pickup slot'}\n\n${lines.map(line=>`${line.product.name} × ${line.qty} — ${money(line.product.price_minor*line.qty)}`).join('\n')}\n\nTotal: ${money(basketTotal())}\nPay at the shop when you collect.\n\nPlace this pickup order?`;
    if(!window.confirm(review))return;
    const key = getRequestKey(); state.loading = true; renderBasket();
    try {
      const result = await api('/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({
        store_id: state.store.id, slot_id: state.slotId,
        items: lines.map(line => ({ product_id: line.product.id, quantity: line.qty, expected_price_minor: line.product.price_minor }))
      }) });
      state.basket = {}; state.quotePrices={};state.slotId = ''; saveBasket(); clearRequestKey(); state.loading = false;
      await refreshData({ quiet: true });
      document.querySelector('.orders-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`Order ${result.order.public_label} placed. Pay at the shop when you collect it.`);
    } catch (error) {
      state.loading = false; renderBasket();
      if (error.status === 409) await refreshData({ quiet: true });
      showNotice(`${error.message} Your basket is still here; review it before trying again.`);
    }
  }
  async function showProductDetails(id){
    let product=state.products.find(item=>item.id===id);
    try{if(!product)product=(await api(`/stores/${encodeURIComponent(state.store.id)}/products/${encodeURIComponent(id)}`)).product;}
    catch(error){showToast(error.message);return;}
    $('productDialogContent').innerHTML=`<div class="product-dialog-art art-${html(product.art)}">${productIcon(product)}</div><div class="eyebrow">${html(product.category)} · ${html(product.unit)}</div><h2 id="dialogProductName">${html(product.name)}</h2><p>${html(product.description||'A neighbourhood-shop pick. Ask the shopkeeper for more details.')}</p><div class="dialog-price">${money(product.price_minor)} · ${product.available>0?`${product.available} available`:'Currently out of stock'}</div><button class="primary-button" type="button" data-action="add" data-id="${html(product.id)}" ${product.available<1?'disabled':''}>Add to basket</button>`;
    $('productDialog').showModal();
  }
  async function toggleSaved(id,save){
    if(!state.user){showToast('Sign in to keep your saved items.');return;}
    try{const result=await api(`/shopper/me/saved-products/${encodeURIComponent(id)}`,{method:save?'PUT':'DELETE'});state.savedProducts=result.products;renderProducts();renderSavedProducts();showToast(save?'Saved for later.':'Removed from saved items.');}
    catch(error){showNotice(error.message);}
  }
  async function shopAgain(orderId){
    const order=state.orders.find(item=>item.id===orderId);if(!order)return;
    if(order.store_id!==state.store?.id){showNotice('Choose the original shop before repeating this order.');return;}
    let added=0;
    for(const item of order.items){const product=(state.allProducts||[]).find(row=>row.id===item.product_id)||state.products.find(row=>row.id===item.product_id);if(!product||product.available<=0)continue;const next=Number(state.basket[product.id]||0)+item.quantity;state.basket[product.id]=Math.min(next,product.available);added++;}
    if(!added){showToast('Those items are currently unavailable.');return;}
    saveBasket();await syncBasket();renderProducts();renderBasket();showToast('Current available items were added at today’s prices. Choose a new pickup slot.');
  }
  async function saveProfile(event){
    event.preventDefault();const data=new FormData(event.currentTarget);
    try{const result=await api('/shopper/me',{method:'PATCH',body:JSON.stringify(Object.fromEntries(data.entries()))});state.profile=result.profile;event.currentTarget.dataset.loaded='';renderProfile();showToast('Account details saved.');}
    catch(error){showNotice(error.message);}
  }
  async function cancelOrder(id, seller = false) {
    if (!window.confirm('Cancel this order before packing starts?')) return;
    try {
      await api(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled before packing' }) });
      await refreshData({ quiet: true }); showToast('Order cancelled; shelf stock and the slot are available again.');
    } catch (error) { showNotice(error.message); }
  }
  async function adjustStock(id, delta) {
    const product = (state.allProducts||[]).find(item => item.id === id)||state.products.find(item => item.id === id); if (!product) return;
    try {
      await api(`/seller/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ on_hand: product.on_hand + delta }) });
      await refreshData({ quiet: true });
    } catch (error) { showToast(error.message); }
  }
  async function toggleProduct(id) {
    const product = (state.allProducts||[]).find(item => item.id === id)||state.products.find(item => item.id === id); if (!product) return;
    try {
      await api(`/seller/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: !product.active }) });
      await refreshData({ quiet: true }); showToast(product.active ? 'Item hidden from the customer shelf.' : 'Item is back on the customer shelf.');
    } catch (error) { showToast(error.message); }
  }
  async function saveProductEdit(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const price = Number(data.get('price'));
    if (!Number.isFinite(price) || price <= 0) { showNotice('Enter a positive item price.'); return; }
    try {
      await api(`/seller/products/${encodeURIComponent(form.dataset.editProduct)}`, { method: 'PATCH', body: JSON.stringify({
        name: String(data.get('name') || '').trim(), unit: String(data.get('unit') || '').trim(), category: data.get('category'),
        description: String(data.get('description')||'').trim(),price_minor: Math.round(price * 100)
      }) });
      await refreshData({ quiet: true }); showToast('Item details updated.');
    } catch (error) { showNotice(error.message); }
  }
  async function addProduct(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const price = Number(data.get('price'));
    const onHand = Number(data.get('stock'));
    try {
      await api(`/seller/stores/${encodeURIComponent(state.store.id)}/products`, { method: 'POST', body: JSON.stringify({
        name: String(data.get('name') || '').trim(), unit: String(data.get('unit') || '').trim(), category: data.get('category'),
        description: String(data.get('description')||'').trim(),price_minor: Math.round(price * 100), on_hand: onHand
      }) });
      form.reset(); form.elements.stock.value = '0'; await refreshData({ quiet: true }); showToast('Item added to the customer catalogue.');
    } catch (error) { showNotice(error.message); }
  }
  async function saveSettings(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
      const result = await api(`/seller/stores/${encodeURIComponent(state.store.id)}/pickup-settings`, { method: 'PUT', body: JSON.stringify({
        evening_start: data.get('evening_start'), evening_end: data.get('evening_end'), slot_minutes: 30,
        capacity: Number(data.get('capacity')), cutoff_minutes: Number(data.get('cutoff_minutes')),
        service_days: data.getAll('service_days').map(Number),
        closure_dates: String(data.get('closure_dates')||'').split(',').map(value=>value.trim()).filter(Boolean)
      }) });
      state.settings = result.settings; form.dataset.loaded=''; await refreshData({ quiet: true }); showToast('Pickup hours saved.');
    } catch (error) { showNotice(error.message); }
  }
  async function sellerAction(url, body = {}) {
    try { await api(url, { method: 'POST', body: JSON.stringify(body) }); await refreshData({ quiet: true }); showToast('Order updated.'); }
    catch (error) { showNotice(error.message); }
  }
  async function resetDemo() {
    if (!window.confirm('Reset the sample catalogue, pickup slots, and all sample orders?')) return;
    try { await api('/demo/reset', { method: 'POST' }); await refreshData({ quiet: true }); showToast('Sample shop reset.'); }
    catch (error) { showNotice(error.message); }
  }
  function nextDate(dateValue) {
    const [year, month, day] = String(dateValue || state.store?.local_date || new Date().toISOString().slice(0, 10)).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }
  async function loadTomorrow() {
    state.selectedDate = nextDate(state.selectedDate || state.store?.local_date || new Date().toISOString().slice(0, 10));
    state.slotId = ''; await refreshData();
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'shopperSignIn') { await signIn('shopper'); return; }
    if (button.id === 'sellerSignIn') { await signIn('seller'); return; }
    if (button.id === 'signOutButton') { await signOut(); return; }
    if (button.id === 'refreshButton') { await refreshData(); showToast('Latest shop and order details loaded.'); return; }
    if (button.id === 'placeOrder') { await placeOrder(); return; }
    if (button.id === 'resetDemo') { await resetDemo(); return; }
    if (button.id === 'loadTomorrow') { await loadTomorrow(); return; }
    if (button.dataset.category) { state.category = button.dataset.category; renderCategories(); void refreshData({quiet:true}); return; }
    if (button.dataset.detail) { await showProductDetails(button.dataset.detail); return; }
    if (button.dataset.save) { await toggleSaved(button.dataset.save,!state.savedProducts.some(item=>item.product_id===button.dataset.save)); return; }
    if (button.dataset.unsave) { await toggleSaved(button.dataset.unsave,false); return; }
    if (button.dataset.saveAdd) { changeQty(button.dataset.saveAdd,1);return; }
    if (button.dataset.reorder) { await shopAgain(button.dataset.reorder);return; }
    if (button.dataset.slot) { state.slotId = button.dataset.slot; renderBasket(); clearRequestKey(); return; }
    if (button.dataset.pickupDate) { state.selectedDate = button.dataset.pickupDate; state.slotId = ''; await refreshData(); return; }
    if (button.dataset.action === 'add' || button.dataset.action === 'plus') { changeQty(button.dataset.id, 1); $('productDialog').close(); return; }
    if (button.dataset.action === 'minus') { changeQty(button.dataset.id, -1); return; }
    if (button.dataset.cancel) { await cancelOrder(button.dataset.cancel); return; }
    if (button.dataset.sellerCancel) { await cancelOrder(button.dataset.sellerCancel, true); return; }
    if (button.dataset.stock === 'up') { await adjustStock(button.dataset.id, 1); return; }
    if (button.dataset.stock === 'down') { await adjustStock(button.dataset.id, -1); return; }
    if (button.dataset.active) { await toggleProduct(button.dataset.active); return; }
    if (button.dataset.startPacking) { await sellerAction(`/seller/orders/${encodeURIComponent(button.dataset.startPacking)}/start-packing`); return; }
    if (button.dataset.markReady) {
      const label = window.prompt('Bag label', `BAG-${String(button.dataset.markReady).slice(0, 6).toUpperCase()}`); if (!label) return;
      const location = window.prompt('Pickup location', state.store?.pickup_location || 'Green rack beside the front counter'); if (!location) return;
      await sellerAction(`/seller/orders/${encodeURIComponent(button.dataset.markReady)}/mark-ready`, { bag_label: label, pickup_location: location }); return;
    }
  });
  document.addEventListener('submit', async event => {
    if (event.target.id === 'productForm') { await addProduct(event); return; }
    if (event.target.matches('[data-edit-product]')) { await saveProductEdit(event); return; }
    if (event.target.id === 'settingsForm') { await saveSettings(event); return; }
    const pickup = event.target.closest('[data-complete]');
    if (pickup) {
      event.preventDefault(); const orderId = pickup.dataset.complete; const data = new FormData(pickup);
      await sellerAction(`/seller/orders/${encodeURIComponent(orderId)}/complete-pickup`, { pickup_code: String(data.get('pickup_code') || '').trim().toUpperCase() });
    }
  });
  $('searchInput').addEventListener('input', event => { state.search = event.target.value; renderProducts(); });
  let catalogTimer;
  $('searchInput').addEventListener('input', event => {state.search=event.target.value;clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>refreshData({quiet:true}),180);});
  $('inStockFilter').addEventListener('change',event=>{state.inStockOnly=event.target.checked;void refreshData({quiet:true});});
  $('minPriceFilter').addEventListener('input',event=>{state.minPrice=event.target.value;clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>refreshData({quiet:true}),250);});
  $('maxPriceFilter').addEventListener('input',event=>{state.maxPrice=event.target.value;clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>refreshData({quiet:true}),250);});
  $('sortFilter').addEventListener('change',event=>{state.sort=event.target.value;void refreshData({quiet:true});});
  $('storeSearch').addEventListener('input',event=>{clearTimeout(catalogTimer);catalogTimer=setTimeout(async()=>{state.selectedStoreId='';await refreshData({quiet:true});},220);});
  $('queueSearch').addEventListener('input',event=>{state.queueSearch=event.target.value;clearTimeout(catalogTimer);catalogTimer=setTimeout(()=>refreshData({quiet:true}),200);});
  $('queueDate').addEventListener('change',event=>{state.queueDate=event.target.value;void refreshData({quiet:true});});
  $('queueStatus').addEventListener('change',event=>{state.queueStatus=event.target.value;void refreshData({quiet:true});});
  $('clearQueueFilters').addEventListener('click',()=>{state.queueSearch='';state.queueDate='';state.queueStatus='';$('queueSearch').value='';$('queueDate').value='';$('queueStatus').value='';void refreshData({quiet:true});});
  $('sellerStoreSelect').addEventListener('change',async event=>{state.selectedStoreId=event.target.value;$('settingsForm').dataset.loaded='';state.queueDate='';await refreshData();});
  $('toggleProfile').addEventListener('click',()=>{$('profilePanel').hidden=!$('profilePanel').hidden;});
  $('savePickupLocation').addEventListener('click',async()=>{if(!state.user||state.mode!=='seller')return;try{const result=await api(`/seller/stores/${encodeURIComponent(state.store.id)}`,{method:'PATCH',body:JSON.stringify({is_open:state.store.is_open,pickup_location:$('pickupLocationInput').value.trim()})});state.store=result.store;renderRole();showToast('Pickup point saved.');}catch(error){showNotice(error.message);}});
  $('toggleStoreOpen').addEventListener('click',async()=>{if(!state.user||state.mode!=='seller')return;try{const result=await api(`/seller/stores/${encodeURIComponent(state.store.id)}`,{method:'PATCH',body:JSON.stringify({is_open:!state.store.is_open})});state.store.is_open=result.store.is_open;renderRole();showToast(state.store.is_open?'Shop is open for pickup.':'Shop is closed to new orders.');}catch(error){showNotice(error.message);}});
  $('profileForm').addEventListener('submit',saveProfile);

  $('storeSelect').addEventListener('change', async event => {
    if(basketCount()&&!window.confirm('Switch shops and clear the current basket?')){event.target.value=state.store.id;return;}
    state.basket={};state.quotePrices={};saveBasket();void syncBasket();state.selectedStoreId = event.target.value;
    state.store = state.stores.find(store => store.id === state.selectedStoreId) || state.store;
    try { localStorage.setItem('kc-selected-store', state.selectedStoreId); } catch {}
    state.basket = {}; loadBasket(); state.slotId = ''; state.selectedDate = undefined; state.products = []; state.allProducts=[]; state.slots = [];
    await refreshData(); await syncBasket();renderAll();
  });
  async function init() {
    try {
      try { state.selectedStoreId = localStorage.getItem('kc-selected-store') || ''; } catch {}
      const session = await api('/auth/session'); state.user = session.user;state.demoAvailable=session.demo_available;
      if (state.user) {
        state.mode = state.user.role;
        history.replaceState({}, '', state.mode === 'seller' ? '/seller' : '/customer');
        loadBasket(); await refreshData(); startPolling();
      } else {await refreshData();renderAll();}
    } catch (error) { showNotice(error.message); renderAll(); }
  }
  init();
})();
