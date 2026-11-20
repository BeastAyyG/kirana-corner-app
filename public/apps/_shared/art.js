// Product/category artwork for the v2 catalogue. Every seeded product id maps to
// an original studio packshot under /img; an emoji SVG tile is the last-resort
// fallback (CSP allows data:). Seller-provided https art is honoured when present.

// v2 product id → packshot filename (without extension).
const PRODUCT_ART = {
  // fruits & vegetables
  tomato: 'tomato', onion: 'onion', potato: 'potato', banana: 'banana',
  coriander: 'coriander', chilli: 'chillies', spinach: 'spinach', lemon: 'lemon',
  // dairy & breakfast
  'amul-milk': 'milk', 'amul-butter': 'paneer', curd: 'curd', paneer: 'paneer',
  eggs: 'eggs', bread: 'bread', cheese: 'paneer', yogurt: 'curd',
  // atta, rice & dal
  atta: 'atta', oil: 'oil', 'toor-dal': 'dal', basmati: 'basmati',
  'sona-rice': 'rice', salt: 'salt', sugar: 'sugar', 'chana-dal': 'chana-dal',
  // masala & dry fruits
  turmeric: 'masala', 'garam-masala': 'masala', almonds: 'dryfruits',
  cashews: 'dryfruits', raisins: 'dryfruits', 'chilli-powder': 'masala',
  // snacks & munchies
  lays: 'chips', bhujia: 'namkeen', 'parle-g': 'biscuits', 'good-day': 'biscuits',
  kurkure: 'namkeen', 'dark-fantasy': 'biscuits', 'mad-angles': 'chips',
  // beverages
  tea: 'tea', coffee: 'beverage', coke: 'beverage', sprite: 'beverage',
  juice: 'beverage', water: 'beverage', redbull: 'beverage',
  // instant & frozen
  maggi: 'noodles', yippee: 'noodles', soup: 'noodles', fries: 'chips',
  poha: 'noodles', ramen: 'noodles',
  // bakery & biscuits
  marie: 'biscuits', muffins: 'bakery', cake: 'bakery', rusk: 'biscuits',
  oreo: 'biscuits', 'brown-bread': 'bread',
  // home & cleaning
  surf: 'cleaning', vim: 'cleaning', lizol: 'cleaning', harpic: 'cleaning',
  'garbage-bags': 'cleaning', scrub: 'cleaning',
  // personal care
  dettol: 'personal', colgate: 'personal', dove: 'personal', nivea: 'personal',
  gillette: 'personal', whisper: 'personal',
  // baby care
  pampers: 'baby', 'baby-powder': 'baby', cerelac: 'baby', wipes: 'baby',
  // pet care
  pedigree: 'pet', whiskas: 'pet', drools: 'pet',
};

// v2 category slug → artwork path.
const CATEGORY_ART = {
  'fruits-vegetables': '/img/categories/vegetables.webp',
  'dairy-breakfast': '/img/categories/dairy.webp',
  'atta-rice-dal': '/img/categories/staples.webp',
  'masala-dry-fruits': '/img/products/dryfruits.webp',
  'snacks-munchies': '/img/categories/snacks.webp',
  beverages: '/img/products/beverage.webp',
  'instant-frozen': '/img/products/noodles.webp',
  'bakery-biscuits': '/img/products/bakery.webp',
  'home-cleaning': '/img/products/cleaning.webp',
  'personal-care': '/img/products/personal.webp',
  'baby-care': '/img/products/baby.webp',
  'pet-care': '/img/products/pet.webp',
};

const CATEGORY_BG = {
  'fruits-vegetables': ['#eef8e0', '#dceec2'],
  'dairy-breakfast': ['#e9f2fd', '#d5e5f7'],
  'atta-rice-dal': ['#fdf3d8', '#f7e6b6'],
  'snacks-munchies': ['#fdeae3', '#f9d6c8'],
  default: ['#f0f7e8', '#e2edd2'],
};
const CATEGORY_EMOJI = {
  'fruits-vegetables': '🥬', 'dairy-breakfast': '🥛', 'atta-rice-dal': '🌾',
  'masala-dry-fruits': '🌶️', 'snacks-munchies': '🍪', beverages: '🥤',
  'instant-frozen': '🍜', 'bakery-biscuits': '🥐', 'home-cleaning': '🧼',
  'personal-care': '🧴', 'baby-care': '🍼', 'pet-care': '🐾',
};

const cache = new Map();
function emojiTile(item) {
  const key = item ? `${item.id || ''}|${item.category_id || ''}` : 'empty';
  if (cache.has(key)) return cache.get(key);
  const emoji = CATEGORY_EMOJI[item?.category_id] || '🛒';
  const [from, to] = CATEGORY_BG[item?.category_id] || CATEGORY_BG.default;
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
  const file = PRODUCT_ART[item?.id];
  if (file) return `/img/products/${file}.webp`;
  return emojiTile(item);
}
export function artForCategory(slug) {
  return CATEGORY_ART[slug] || emojiTile({ category_id: slug });
}
export function hasPackshot(id) { return Boolean(PRODUCT_ART[id]); }

/** CSP-safe staged error fallback (delegated capture listener in main.js):
 *  external art → local packshot → emoji tile. Never a broken image. */
export function handleImgError(img) {
  const stage = Number(img.dataset.fbk || 0);
  const id = img.dataset.artId || '';
  const category = img.dataset.artCat || '';
  const file = PRODUCT_ART[id];
  if (stage === 0 && file && !img.getAttribute('src')?.startsWith('/img/products/')) {
    img.dataset.fbk = '1';
    img.src = `/img/products/${file}.webp`;
    return;
  }
  if (stage < 2) {
    img.dataset.fbk = '2';
    img.src = emojiTile({ id, category_id: category });
  }
}