// Product/category artwork as inline SVG data URIs (CSP allows img-src data:).
// The backend exposes image_url; when empty we render a colorful emoji tile
// similar to how grocery apps illustrate catalogues without photos.

const PRODUCT_EMOJI = {
  tomato: '🍅', onion: '🧅', banana: '🍌', potato: '🥔', chillies: '🌶️',
  spinach: '🥬', coriander: '🌿', milk: '🥛', bread: '🍞', curd: '🍶',
  paneer: '🧈', eggs: '🥚', dal: '🫘', 'chana-dal': '🫘', atta: '🌾',
  rice: '🍚', basmati: '🍚', sugar: '🥮', salt: '🧂', oil: '🫒', tea: '🍵',
  biscuits: '🍪', chips: '🥔', namkeen: '🥨',
};
const CATEGORY_EMOJI = {
  Vegetables: '🥬', Dairy: '🥛', Staples: '🌾', Snacks: '🍪',
};
const CATEGORY_BG = {
  Vegetables: ['#eef8e0', '#dceec2'],
  Dairy: ['#e9f2fd', '#d5e5f7'],
  Staples: ['#fdf3d8', '#f7e6b6'],
  Snacks: ['#fdeae3', '#f9d6c8'],
  default: ['#f0f7e8', '#e2edd2'],
};

const cache = new Map();

export function artFor(item) {
  const key = item ? `${item.id || ''}|${item.category || ''}|${item.image_url || ''}` : 'empty';
  if (cache.has(key)) return cache.get(key);
  const emoji = PRODUCT_EMOJI[item?.id] || CATEGORY_EMOJI[item?.category] || '🛒';
  const [from, to] = CATEGORY_BG[item?.category] || CATEGORY_BG.default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="200" height="200" fill="url(#g)"/>` +
    `<circle cx="100" cy="96" r="62" fill="rgba(255,255,255,.55)"/>` +
    `<text x="100" y="100" font-size="72" text-anchor="middle" dominant-baseline="central" font-family="'Segoe UI Emoji','Noto Color Emoji',sans-serif">${emoji}</text>` +
    `</svg>`;
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

export const CATEGORY_META = [
  { key: 'All', emoji: '🛒', tint: 'cat-all', label: 'Everything' },
  { key: 'Vegetables', emoji: '🥬', tint: 'cat-veg', label: 'Vegetables' },
  { key: 'Dairy', emoji: '🥛', tint: 'cat-dairy', label: 'Dairy' },
  { key: 'Staples', emoji: '🌾', tint: 'cat-staple', label: 'Staples' },
  { key: 'Snacks', emoji: '🍪', tint: 'cat-snack', label: 'Snacks' },
];
