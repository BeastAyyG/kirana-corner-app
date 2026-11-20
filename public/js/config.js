// Frontend configuration. The backend agent can override the API origin by
// defining window.KIRANA_API_BASE before this script loads (e.g. when the
// frontend is served from static hosting and the API lives elsewhere).
const host = typeof window !== 'undefined' ? window.KIRANA_API_BASE || '' : '';
export const API_BASE = `${host.replace(/\/+$/, '')}/api/v1`;
export const APP_VERSION = '2.0.0';
export const BRAND = {
  name: 'Kirana Corner',
  partnerName: 'Kirana Partner',
  tagline: 'Shop nearby, pick up easy',
};
