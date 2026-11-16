(() => {
  const API = '/api/v1';
  const storeId = 'saathi-kirana';
  const categories = ['All', 'Vegetables', 'Dairy', 'Staples', 'Snacks'];
  const artGlyph = { veg: '♧', dairy: '♜', staple: '▱', snack: '▣' };
  const money = minor => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(minor || 0) / 100);
  const $ = id => document.getElementById(id);
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { user: null, mode: location.pathname === '/seller' ? 'seller' : 'shopper', store: null, stores: [], selectedStoreId: '', demoAvailable: true, products: [], slots: [], orders: [], category: 'All', search: '', slotId: '', basket: {}, settings: null, loading: false, poll: null };
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
  function loadBasket() {
    try { state.basket = JSON.parse(localStorage.getItem(basketKey()) || '{}') || {}; }
    catch { state.basket = {}; }
  }
  function saveBasket() {
    try { localStorage.setItem(basketKey(), JSON.stringify(state.basket)); }
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
    return Object.entries(state.basket).map(([id, qty]) => ({ product: state.products.find(p => p.id === id), qty: Number(qty) }))
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
    $('customerView').hidden = !state.user || isSeller;
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
    $('storeSelectWrap').hidden = isSeller || storeChoices.length < 2;
    $('storeSelect').innerHTML = storeChoices.map(store => `<option value="${html(store.id)}" ${store.id === state.store?.id ? 'selected' : ''}>${html(store.name)}</option>`).join('');
  }
  function renderCategories() {
    $('categoryRow').innerHTML = categories.map(category => `<button class="category-button" type="button" data-category="${html(category)}" aria-pressed="${state.category === category}">${html(category)}</button>`).join('');
  }
  function renderProducts() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.products.filter(product => (state.category === 'All' || product.category === state.category) &&
      (!query || `${product.name} ${product.category}`.toLowerCase().includes(query)));
    $('productGrid').innerHTML = filtered.length ? filtered.map(product => {
      const qty = Number(state.basket[product.id] || 0); const available = product.available > 0;
      const pill = available ? `${product.available} on shelf` : 'Sold out';
      const stockClass = !available ? 'out' : product.available <= 3 ? 'low' : '';
      const control = qty ? `<div class="qty-control" aria-label="${html(product.name)} quantity"><button type="button" data-action="minus" data-id="${html(product.id)}" aria-label="Remove one ${html(product.name)}">−</button><output>${qty}</output><button type="button" data-action="plus" data-id="${html(product.id)}" aria-label="Add one ${html(product.name)}" ${qty >= product.available ? 'disabled' : ''}>+</button></div>`
        : `<button class="add-button" type="button" data-action="add" data-id="${html(product.id)}" ${!available ? 'disabled' : ''}>${available ? 'Add +' : 'Unavailable'}</button>`;
      return `<article class="product-card"><div class="product-top"><div class="product-art art-${html(product.art)}" aria-hidden="true">${productIcon(product)}</div><span class="stock-pill ${stockClass}">${pill}</span></div><div class="product-info"><h3 class="product-name">${html(product.name)}</h3><div class="product-unit">${html(product.unit)} · ${html(product.category)}</div><div class="product-bottom"><div class="price">${money(product.price_minor)}<span class="price-note">pay at store</span></div>${control}</div></div></article>`;
    }).join('') : '<div class="empty-state">No shelf items match. Try another search or category.</div>';
  }
  function renderBasket() {
    const lines = basketLines(); $('basketCount').textContent = String(basketCount());
    if (!lines.length) {
      $('basketContent').innerHTML = '<div class="basket-empty"><strong>Your basket is waiting</strong>Add some shelf items, then choose an evening pickup time.</div>' + renderSlots() + renderTotals();
      return;
    }
    const stale = lines.some(({ product, qty }) => qty > product.available);
    const contents = lines.map(({ product, qty }) => `<div class="basket-line"><div><div class="basket-item-name">${html(product.name)} × ${qty}</div><div class="basket-item-meta">${html(product.unit)} · ${product.available} currently available</div></div><div class="basket-item-total">${money(product.price_minor * qty)}</div></div>`).join('');
    const warning = stale ? '<p class="cart-warning">Shelf stock changed. Reduce the marked quantities before placing this order.</p>' : '';
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
      const slot = `${new Date(order.pickup_starts_at).toLocaleDateString('en-IN', { timeZone: order.time_zone, weekday: 'short', day: 'numeric', month: 'short' })} · ${html(order.pickup_slot_label)}`;
      return `<article class="order-card"><div class="order-banner"><div><div class="order-label-caption">Pickup reference</div><div class="order-label">${html(order.public_label)}</div></div><span class="status-chip ${html(order.status)}"><i></i>${html(statusText(order.status))}</span></div><div class="order-content"><div><div class="detail-label">Pickup time</div><div class="detail-value">${slot}</div><div class="detail-label pickup-point-label">Pickup point</div><div class="detail-value">${html(order.pickup_location)}</div><div class="bag-label">▧ One bag · ${html(order.bag_label)}</div>${code}</div><div><div class="detail-label">Order contents</div><div class="order-items">${items}</div><div class="total-row"><span>Total · pay at store</span><span>${money(order.total_minor)}</span></div></div>${renderTimeline(order.status)}${cancel}</div></article>`;
    }).join('');
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
    if (order.status === 'ready') actions = `<form class="pickup-form" data-complete="${html(order.id)}"><label class="sr-only">Customer pickup code<input name="pickup_code" autocomplete="one-time-code" minlength="8" maxlength="8" placeholder="8-character code" required></label><button class="small-button" type="submit">Verify &amp; hand over</button></form>`;
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
    form.dataset.loaded = 'yes';
  }
  function renderAll() {
    renderRole();
    if (!state.user) return;
    if (state.mode === 'seller') { renderInventory(); renderSellerOrders(); renderSettings(); }
    else { renderCategories(); renderProducts(); renderBasket(); renderCustomerOrders(); }
  }
  async function refreshData({quiet = false} = {}) {
    if (!state.user) return;
    try {
      clearNotice();
      const storeResult = await api('/stores');
      state.stores = storeResult.stores;
      state.store = state.stores.find(store => store.id === (state.selectedStoreId || storeId)) || state.stores[0] || null;
      if (!state.store) throw new Error('No sample shop is available.');
      state.selectedStoreId = state.store.id;
      if (state.mode === 'seller') {
        const [products, orders, settings] = await Promise.all([
          api(`/seller/stores/${encodeURIComponent(state.store.id)}/products`),
          api(`/seller/stores/${encodeURIComponent(state.store.id)}/orders`),
          api(`/seller/stores/${encodeURIComponent(state.store.id)}/pickup-settings`)
        ]);
        state.products = products.products; state.orders = orders.orders; state.settings = settings.settings;
      } else {
        const date = state.selectedDate || state.store.local_date || new Date().toISOString().slice(0, 10);
        state.selectedDate = date;
        const [products, slots, orders] = await Promise.all([
          api(`/stores/${encodeURIComponent(state.store.id)}/products`),
          api(`/stores/${encodeURIComponent(state.store.id)}/pickup-slots?date=${encodeURIComponent(date)}`),
          api('/orders')
        ]);
        state.products = products.products; state.slots = slots.slots; state.orders = orders.orders;
        if (state.slotId && !state.slots.some(slot => slot.id === state.slotId)) state.slotId = '';
        for (const id of Object.keys(state.basket)) {
          const product = state.products.find(item => item.id === id);
          if (!product || !product.active) delete state.basket[id];
        }
        saveBasket();
      }
      renderAll();
    } catch (error) {
      if (error.status === 401) { state.user = null; renderAll(); }
      else if (!quiet) showNotice(`${error.message} Use Refresh to try again.`);
    }
  }
  async function signIn(role) {
    try {
      const result = await api('/auth/demo', { method: 'POST', body: JSON.stringify({ role }) });
      state.user = result.user; state.mode = role;
      state.category = 'All'; state.search = ''; state.selectedDate = undefined; state.slotId = '';
      $('searchInput').value = ''; loadBasket();
      history.replaceState({}, '', role === 'seller' ? '/seller' : '/customer');
      await refreshData();
      showToast(`Signed in to the sample ${role === 'seller' ? 'shopkeeper' : 'shopper'} account.`);
      startPolling();
    } catch (error) { showNotice(error.message); }
  }
  async function signOut() {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    state.user = null; state.orders = []; state.products = []; state.basket = {}; stopPolling(); renderAll();
    history.replaceState({}, '', '/customer');
  }
  function startPolling() { stopPolling(); state.poll = setInterval(() => refreshData({ quiet: true }), 5000); }
  function stopPolling() { if (state.poll) clearInterval(state.poll); state.poll = null; }
  function changeQty(id, delta) {
    const product = state.products.find(item => item.id === id); if (!product) return;
    const next = Number(state.basket[id] || 0) + delta;
    if (next < 1) delete state.basket[id];
    else if (next > product.available) { showToast(`Only ${product.available} ${product.name} on the shelf.`); return; }
    else state.basket[id] = next;
    state.slotId = state.slots.some(slot => slot.id === state.slotId) ? state.slotId : '';
    clearRequestKey(); saveBasket(); renderProducts(); renderBasket();
  }
  async function placeOrder() {
    const lines = basketLines();
    if (!lines.length || !state.slotId) { showToast('Add an item and choose a pickup time first.'); return; }
    const key = getRequestKey(); state.loading = true; renderBasket();
    try {
      const result = await api('/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({
        store_id: state.store.id, slot_id: state.slotId,
        items: lines.map(line => ({ product_id: line.product.id, quantity: line.qty, expected_price_minor: line.product.price_minor }))
      }) });
      if (result.order.pickup_code) {
        try { localStorage.setItem(`kc-pickup-code:${result.order.id}`, result.order.pickup_code); } catch {}
      }
      state.basket = {}; state.slotId = ''; saveBasket(); clearRequestKey(); state.loading = false;
      await refreshData({ quiet: true });
      document.querySelector('.orders-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`Order ${result.order.public_label} placed. Pay at the shop when you collect it.`);
    } catch (error) {
      state.loading = false; renderBasket();
      if (error.status === 409) await refreshData({ quiet: true });
      showNotice(`${error.message} Your basket is still here; review it before trying again.`);
    }
  }
  async function cancelOrder(id, seller = false) {
    if (!window.confirm('Cancel this order before packing starts?')) return;
    try {
      await api(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled before packing' }) });
      await refreshData({ quiet: true }); showToast('Order cancelled; shelf stock and the slot are available again.');
    } catch (error) { showNotice(error.message); }
  }
  async function adjustStock(id, delta) {
    const product = state.products.find(item => item.id === id); if (!product) return;
    try {
      await api(`/seller/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ on_hand: product.on_hand + delta }) });
      await refreshData({ quiet: true });
    } catch (error) { showToast(error.message); }
  }
  async function toggleProduct(id) {
    const product = state.products.find(item => item.id === id); if (!product) return;
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
        price_minor: Math.round(price * 100)
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
        price_minor: Math.round(price * 100), on_hand: onHand
      }) });
      form.reset(); form.elements.stock.value = '0'; await refreshData({ quiet: true }); showToast('Item added to the customer catalogue.');
    } catch (error) { showNotice(error.message); }
  }
  async function saveSettings(event) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    try {
      const result = await api(`/seller/stores/${encodeURIComponent(state.store.id)}/pickup-settings`, { method: 'PUT', body: JSON.stringify({
        evening_start: data.get('evening_start'), evening_end: data.get('evening_end'), slot_minutes: 30,
        capacity: Number(data.get('capacity')), cutoff_minutes: Number(data.get('cutoff_minutes'))
      }) });
      state.settings = result.settings; await refreshData({ quiet: true }); showToast('Pickup hours saved.');
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
    const [year, month, day] = String(dateValue || new Date().toISOString().slice(0, 10)).split('-').map(Number);
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
    if (button.dataset.category) { state.category = button.dataset.category; renderCategories(); renderProducts(); return; }
    if (button.dataset.slot) { state.slotId = button.dataset.slot; renderBasket(); clearRequestKey(); return; }
    if (button.dataset.pickupDate) { state.selectedDate = button.dataset.pickupDate; state.slotId = ''; await refreshData(); return; }
    if (button.dataset.action === 'add' || button.dataset.action === 'plus') { changeQty(button.dataset.id, 1); return; }
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
  $('storeSelect').addEventListener('change', async event => {
    saveBasket(); state.selectedStoreId = event.target.value;
    state.store = state.stores.find(store => store.id === state.selectedStoreId) || state.store;
    try { localStorage.setItem('kc-selected-store', state.selectedStoreId); } catch {}
    state.basket = {}; loadBasket(); state.slotId = ''; state.selectedDate = undefined; state.products = []; state.slots = [];
    await refreshData(); renderAll();
  });
  async function init() {
    try {
      try { state.selectedStoreId = localStorage.getItem('kc-selected-store') || ''; } catch {}
      const session = await api('/auth/session'); state.user = session.user;
      if (state.user) {
        state.mode = state.user.role;
        history.replaceState({}, '', state.mode === 'seller' ? '/seller' : '/customer');
        loadBasket(); await refreshData(); startPolling();
      } else renderAll();
    } catch (error) { showNotice(error.message); renderAll(); }
  }
  init();
})();
