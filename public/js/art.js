// Product/category artwork. Local studio packshots (public/img) win for the
// seeded catalogue; seller-provided https art is honoured when present; the
// emoji SVG tile remains only as a last-resort fallback (CSP allows data:).

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

const LOCAL_PRODUCTS = new Set(Object.keys(PRODUCT_EMOJI));
const CATEGORY_SLUG = { Vegetables: 'vegetables', Dairy: 'dairy', Staples: 'staples', Snacks: 'snacks' };

const cache = new Map();

function emojiTile(item) {
  const key = item ? `${item.id || ''}|${item.category || ''}` : 'empty';
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

export function artFor(item) {
  if (item?.image_url) return item.image_url;
  if (item?.id && LOCAL_PRODUCTS.has(item.id)) return `/img/products/${item.id}.webp`;
  return emojiTile(item);
}

export function artForCategory(key) {
  const slug = CATEGORY_SLUG[key];
  return slug ? `/img/categories/${slug}.webp` : emojiTile({ category: key });
}

/** CSP-safe error fallback (delegated capture listener in main.js):
 *  external art → local packshot → emoji tile. Never a broken image. */
export function handleImgError(img) {
  const stage = Number(img.dataset.fbk || 0);
  const id = img.dataset.artId || '';
  const category = img.dataset.artCat || '';
  if (stage === 0 && id && LOCAL_PRODUCTS.has(id) && !img.getAttribute('src')?.startsWith('/img/products/')) {
    img.dataset.fbk = '1';
    img.src = `/img/products/${id}.webp`;
    return;
  }
  if (stage < 2) {
    img.dataset.fbk = '2';
    img.src = emojiTile({ id, category });
  }
}

export const CATEGORY_META = [
  { key: 'All', slug: '', tint: 'cat-all', label: 'All' },
  { key: 'Vegetables', slug: 'vegetables', tint: 'cat-veg', label: 'Vegetables' },
  { key: 'Dairy', slug: 'dairy', tint: 'cat-dairy', label: 'Dairy' },
  { key: 'Staples', slug: 'staples', tint: 'cat-staple', label: 'Staples' },
  { key: 'Snacks', slug: 'snacks', tint: 'cat-snack', label: 'Snacks' },
];