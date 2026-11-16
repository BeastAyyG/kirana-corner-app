// Welcome / sample sign-in screen (BigBasket-style splash + role chooser).
import { state } from '../state.js';
import { esc, icon, LOGO_BASKET } from '../ui.js';
import { navigate } from '../router.js';
import { signInDemo } from '../actions.js';
import { BRAND } from '../config.js';

export async function renderWelcome(outlet) {
  outlet.innerHTML = `
    <div class="welcome">
      <div class="pilot-strip">PILOT BUILD · SAMPLE ACCOUNTS · PAY AT STORE</div>
      <div class="welcome-hero">
        <span class="logo-mark">${LOGO_BASKET}</span>
        <h1>${esc(BRAND.name)}</h1>
        <p>Order groceries from your neighbourhood kirana and collect them in an evening pickup slot.</p>
      </div>
      <div class="welcome-tiles">
        <div class="welcome-tile"><span class="t-emoji">🧺</span><strong>Reserve a slot</strong><span>One labeled bag, packed for you</span></div>
        <div class="welcome-tile"><span class="t-emoji">🏪</span><strong>Local shelf stock</strong><span>Real quantities from the shop</span></div>
        <div class="welcome-tile"><span class="t-emoji">🤝</span><strong>Pay at the store</strong><span>No online payment needed</span></div>
        <div class="welcome-tile"><span class="t-emoji">🛍️</span><strong>Two apps in one</strong><span>Shopper + shopkeeper views</span></div>
      </div>
      <div class="welcome-body">
        ${state.session.demoAvailable ? `
          <button class="btn btn-primary block" data-signin="shopper">Continue as shopper ${icon('chevronRight')}</button>
          <button class="btn btn-outline block" data-signin="seller">Continue as shopkeeper ${icon('chevronRight')}</button>
          <button class="btn btn-ghost block" data-browse>Browse without signing in</button>
        ` : `
          <div class="notice notice-warn">${icon('alert')}<span>Sample sign-in is disabled here. Real account sign-in has not been set up yet — you can still browse the catalogue.</span></div>
          <button class="btn btn-primary block" data-browse>Browse the catalogue</button>
        `}
      </div>
      <p class="welcome-note">Prototype · no online payments · store times follow the shop’s local clock</p>
    </div>`;

  outlet.querySelector('[data-browse]')?.addEventListener('click', () => navigate('#/home'));
  outlet.querySelectorAll('[data-signin]').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const role = button.dataset.signin;
      const ok = await signInDemo(role);
      if (ok) navigate(role === 'seller' ? '#/seller' : '#/home');
      else button.disabled = false;
    });
  });
}
