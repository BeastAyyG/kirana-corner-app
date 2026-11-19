// Admin sign-in: full-screen OTP flow (same UX as the customer app). In dev
// the API returns dev_code, which we surface and auto-fill for a quick demo.
// Only role=admin sessions pass; anything else is signed out immediately.
import { api, setToken } from '../../_shared/api.js';
import { icon, LOGO_BASKET, toast, esc } from '../../_shared/ui.js';
import { bootstrap, state } from '../state.js';

export async function authView(outlet, params, query, { router }) {
  let step = 'phone';
  let phone = '';
  let devCode = '';
  let resendIn = 0;
  let resendTimer = null;
  let busy = false;

  function render() {
    outlet.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-hero">
          <span class="logo-mark">${LOGO_BASKET}</span>
          <h1>Kirana Ops</h1>
          <p>The operations desk for the Kirana Corner delivery network. Orders, stores, staff, coupons and audit — one console.</p>
        </div>
        <div class="auth-body">
          ${step === 'phone' ? phoneStep() : otpStep()}
        </div>
        <div class="role-switch">
          <a href="/apps/customer/index.html">Customer</a>
          <a href="/apps/store/index.html">Store picker</a>
          <a href="/apps/rider/index.html">Rider</a>
          <a href="/apps/admin/index.html" class="on">Admin</a>
          <a href="/customer">Pickup app</a>
        </div>
      </div>`;
    wire();
  }

  function phoneStep() {
    return `
      <div class="field">
        <label for="auth-phone">Admin mobile number</label>
        <div class="phone-field">
          <span class="cc">+91</span>
          <input id="auth-phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="90000 00001" value="${esc(phone.replace(/^\+91/, ''))}">
        </div>
        <span class="hint">Restricted to operations staff. Demo admin: 90000 00001</span>
      </div>
      <button class="btn btn-primary block" data-send-otp ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Send OTP'} ${icon('arrowRight')}</button>
      <p class="welcome-note">Sign-in is logged to the audit trail.</p>`;
  }

  function otpStep() {
    const digits = devCode ? devCode.split('') : ['', '', '', '', '', ''];
    return `
      <div class="field">
        <label>Enter the 6-digit code sent to +91 ${esc(phone.replace(/^\+91/, ''))}</label>
        <div class="otp-input-row" data-otp-row>
          ${digits.map((d, i) => `<input type="tel" inputmode="numeric" maxlength="1" data-otp-digit="${i}" value="${esc(d)}" aria-label="Digit ${i + 1}">`).join('')}
        </div>
      </div>
      ${devCode ? `<div class="dev-code-note">Demo mode: code ${esc(devCode)} auto-filled</div>` : ''}
      <button class="btn btn-primary block" data-verify ${busy ? 'disabled' : ''}>${busy ? 'Verifying…' : 'Verify & continue'} ${icon('check')}</button>
      <div class="auth-meta">
        <button data-edit-phone>${icon('chevronLeft')} Change number</button>
        <button data-resend ${resendIn > 0 ? 'disabled' : ''}>${resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'}</button>
      </div>`;
  }

  function wire() {
    outlet.querySelector('[data-send-otp]')?.addEventListener('click', sendOtp);
    outlet.querySelector('#auth-phone')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendOtp(); });
    outlet.querySelector('[data-verify]')?.addEventListener('click', verify);
    outlet.querySelector('[data-edit-phone]')?.addEventListener('click', () => { step = 'phone'; render(); });
    outlet.querySelector('[data-resend]')?.addEventListener('click', sendOtp);
    const row = outlet.querySelector('[data-otp-row]');
    if (row) {
      const inputs = [...row.querySelectorAll('input')];
      inputs.forEach((input, i) => {
        input.addEventListener('input', () => {
          input.value = input.value.replace(/\D/g, '').slice(0, 1);
          if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
          if (inputs.every(inp => inp.value)) verify();
        });
        input.addEventListener('keydown', e => {
          if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
          if (e.key === 'Enter') verify();
        });
        input.addEventListener('paste', e => {
          const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
          if (text.length === 6) { e.preventDefault(); inputs.forEach((inp, j) => { inp.value = text[j]; }); verify(); }
        });
      });
      if (!devCode) inputs[0]?.focus();
    }
  }

  async function sendOtp() {
    const input = outlet.querySelector('#auth-phone');
    const raw = (input?.value || phone).replace(/\D/g, '').slice(-10);
    if (raw.length !== 10) { toast('Enter a valid 10-digit mobile number', 'error'); input?.focus(); return; }
    phone = `+91${raw}`;
    busy = true; render();
    try {
      const res = await api.requestOtp(phone);
      devCode = res.dev_code || '';
      resendIn = res.resend_after_seconds || 30;
      step = 'otp'; busy = false; render();
      startResend();
      if (devCode) setTimeout(verify, 350);
    } catch (error) {
      busy = false; step = 'phone'; render();
      toast(error.message || 'Could not send OTP', 'error');
    }
  }

  function startResend() {
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      resendIn = Math.max(0, resendIn - 1);
      const btn = outlet.querySelector('[data-resend]');
      if (btn) { btn.disabled = resendIn > 0; btn.textContent = resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'; }
      if (resendIn === 0) clearInterval(resendTimer);
    }, 1000);
  }

  async function verify() {
    if (busy) return;
    const inputs = [...outlet.querySelectorAll('[data-otp-digit]')];
    const code = inputs.map(i => i.value).join('');
    if (code.length !== 6) { toast('Enter the 6-digit code', 'error'); return; }
    busy = true;
    const btn = outlet.querySelector('[data-verify]');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
    try {
      const res = await api.verifyOtp(phone, code);
      setToken(res.token);
      await bootstrap();
      if (!state.user) {
        busy = false; step = 'phone'; devCode = ''; render();
        toast('This account does not have admin access', 'error');
        return;
      }
      toast(`Welcome${res.user?.name ? ', ' + res.user.name : ''}!`, 'success');
      router.navigate('/', { replace: true });
    } catch (error) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = `Verify & continue ${icon('check')}`; }
      toast(error.message || 'Invalid code', 'error');
    }
  }

  render();
  return () => { if (resendTimer) clearInterval(resendTimer); };
}