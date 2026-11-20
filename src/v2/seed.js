import { isoNow } from './util.js';

export const CATEGORIES = [
  { id: 'fruits-vegetables', name: 'Fruits & Vegetables', sort: 1 },
  { id: 'dairy-breakfast', name: 'Dairy & Breakfast', sort: 2 },
  { id: 'atta-rice-dal', name: 'Atta, Rice & Dal', sort: 3 },
  { id: 'masala-dry-fruits', name: 'Masala & Dry Fruits', sort: 4 },
  { id: 'snacks-munchies', name: 'Snacks & Munchies', sort: 5 },
  { id: 'beverages', name: 'Beverages', sort: 6 },
  { id: 'instant-frozen', name: 'Instant & Frozen', sort: 7 },
  { id: 'bakery-biscuits', name: 'Bakery & Biscuits', sort: 8 },
  { id: 'home-cleaning', name: 'Home & Cleaning', sort: 9 },
  { id: 'personal-care', name: 'Personal Care', sort: 10 },
  { id: 'baby-care', name: 'Baby Care', sort: 11 },
  { id: 'pet-care', name: 'Pet Care', sort: 12 }
];

// [id, category, name, brand, unit, price₹, mrp₹, aisle, shelf]
const P = (id, category, name, brand, unit, price, mrp, aisle, shelf) =>
  ({ id, category, name, brand, unit, price_minor: price * 100, mrp_minor: mrp * 100, aisle, shelf });

export const PRODUCTS = [
  P('tomato', 'fruits-vegetables', 'Tomato (Hybrid)', 'Fresh', '500 g', 28, 35, 'A1', 'S1'),
  P('onion', 'fruits-vegetables', 'Onion', 'Fresh', '1 kg', 36, 45, 'A1', 'S1'),
  P('potato', 'fruits-vegetables', 'Potato', 'Fresh', '1 kg', 32, 40, 'A1', 'S2'),
  P('banana', 'fruits-vegetables', 'Banana (Robusta)', 'Fresh', '6 pieces', 40, 50, 'A1', 'S2'),
  P('coriander', 'fruits-vegetables', 'Coriander Leaves', 'Fresh', '100 g', 10, 15, 'A1', 'S3'),
  P('chilli', 'fruits-vegetables', 'Green Chilli', 'Fresh', '100 g', 15, 20, 'A1', 'S3'),
  P('spinach', 'fruits-vegetables', 'Spinach (Palak)', 'Fresh', '250 g', 25, 30, 'A1', 'S4'),
  P('lemon', 'fruits-vegetables', 'Lemon', 'Fresh', '4 pieces', 20, 28, 'A1', 'S4'),
  P('amul-milk', 'dairy-breakfast', 'Taaza Toned Milk', 'Amul', '500 ml', 27, 28, 'A2', 'S1'),
  P('amul-butter', 'dairy-breakfast', 'Butter', 'Amul', '100 g', 56, 62, 'A2', 'S1'),
  P('curd', 'dairy-breakfast', 'Fresh Curd', 'Mother Dairy', '400 g', 35, 40, 'A2', 'S2'),
  P('paneer', 'dairy-breakfast', 'Fresh Paneer', 'Amul', '200 g', 85, 95, 'A2', 'S2'),
  P('eggs', 'dairy-breakfast', 'Farm Eggs', 'Farm Made', '6 pieces', 48, 60, 'A2', 'S3'),
  P('bread', 'dairy-breakfast', 'Whole Wheat Bread', 'Britannia', '400 g', 42, 50, 'A2', 'S3'),
  P('cheese', 'dairy-breakfast', 'Cheese Slices', 'Amul', '200 g', 125, 140, 'A2', 'S4'),
  P('yogurt', 'dairy-breakfast', 'Greek Yogurt (Blueberry)', 'Epigamia', '90 g', 35, 45, 'A2', 'S4'),
  P('atta', 'atta-rice-dal', 'Whole Wheat Atta', 'Aashirvaad', '5 kg', 245, 290, 'A3', 'S1'),
  P('oil', 'atta-rice-dal', 'Sunflower Oil', 'Fortune', '1 L', 145, 165, 'A3', 'S1'),
  P('toor-dal', 'atta-rice-dal', 'Unpolished Toor Dal', 'Tata Sampann', '1 kg', 172, 195, 'A3', 'S2'),
  P('basmati', 'atta-rice-dal', 'Classic Basmati Rice', 'India Gate', '1 kg', 125, 150, 'A3', 'S2'),
  P('sona-rice', 'atta-rice-dal', 'Sona Masoori Rice', 'India Gate', '5 kg', 325, 380, 'A3', 'S3'),
  P('salt', 'atta-rice-dal', 'Iodised Salt', 'Tata', '1 kg', 27, 30, 'A3', 'S3'),
  P('sugar', 'atta-rice-dal', 'Sugar', 'Madhur', '1 kg', 42, 50, 'A3', 'S4'),
  P('chana-dal', 'atta-rice-dal', 'Chana Dal', 'Tata Sampann', '500 g', 62, 75, 'A3', 'S4'),
  P('turmeric', 'masala-dry-fruits', 'Turmeric Powder', 'Everest', '200 g', 55, 68, 'A4', 'S1'),
  P('garam-masala', 'masala-dry-fruits', 'Garam Masala', 'MDH', '100 g', 72, 85, 'A4', 'S1'),
  P('almonds', 'masala-dry-fruits', 'California Almonds', 'Tata Sampann', '500 g', 399, 499, 'A4', 'S2'),
  P('cashews', 'masala-dry-fruits', 'Whole Cashews', 'Nutraj', '250 g', 225, 280, 'A4', 'S2'),
  P('raisins', 'masala-dry-fruits', 'Seedless Raisins', 'Nutraj', '250 g', 99, 130, 'A4', 'S3'),
  P('chilli-powder', 'masala-dry-fruits', 'Red Chilli Powder', 'Everest', '200 g', 62, 75, 'A4', 'S3'),
  P('lays', 'snacks-munchies', "Classic Salted Chips", "Lay's", '52 g', 20, 20, 'A5', 'S1'),
  P('bhujia', 'snacks-munchies', 'Aloo Bhujia', "Haldiram's", '200 g', 40, 52, 'A5', 'S1'),
  P('parle-g', 'snacks-munchies', 'Glucose Biscuits', 'Parle-G', '800 g', 80, 95, 'A5', 'S2'),
  P('good-day', 'snacks-munchies', 'Cashew Cookies', 'Britannia Good Day', '250 g', 35, 45, 'A5', 'S2'),
  P('kurkure', 'snacks-munchies', 'Masala Munch', 'Kurkure', '90 g', 20, 25, 'A5', 'S3'),
  P('dark-fantasy', 'snacks-munchies', 'Choco Fills', 'Sunfeast Dark Fantasy', '75 g', 30, 40, 'A5', 'S3'),
  P('mad-angles', 'snacks-munchies', 'Achaari Masti', 'Bingo Mad Angles', '72 g', 20, 25, 'A5', 'S4'),
  P('tea', 'beverages', 'Premium Leaf Tea', 'Tata Tea', '250 g', 55, 70, 'A6', 'S1'),
  P('coffee', 'beverages', 'Classic Instant Coffee', 'Nescafé', '50 g', 145, 170, 'A6', 'S1'),
  P('coke', 'beverages', 'Coca-Cola', 'Coca-Cola', '750 ml', 40, 45, 'A6', 'S2'),
  P('sprite', 'beverages', 'Sprite', 'Sprite', '750 ml', 40, 45, 'A6', 'S2'),
  P('juice', 'beverages', 'Mixed Fruit Juice', 'Real', '1 L', 99, 120, 'A6', 'S3'),
  P('water', 'beverages', 'Packaged Water', 'Bisleri', '1 L', 20, 22, 'A6', 'S3'),
  P('redbull', 'beverages', 'Energy Drink', 'Red Bull', '250 ml', 115, 125, 'A6', 'S4'),
  P('maggi', 'instant-frozen', 'Masala Noodles (4-pack)', 'Maggi', '280 g', 56, 68, 'A7', 'S1'),
  P('yippee', 'instant-frozen', 'Magic Masala Noodles', 'Sunfeast Yippee', '280 g', 55, 65, 'A7', 'S1'),
  P('soup', 'instant-frozen', 'Mixed Veg Soup', 'Knorr', '44 g', 20, 25, 'A7', 'S2'),
  P('fries', 'instant-frozen', 'French Fries', 'McCain', '420 g', 99, 125, 'A7', 'S2'),
  P('poha', 'instant-frozen', 'Ready Poha', 'MTR', '180 g', 35, 45, 'A7', 'S3'),
  P('ramen', 'instant-frozen', 'Curry Noodles', 'Top Ramen', '280 g', 50, 60, 'A7', 'S3'),
  P('marie', 'bakery-biscuits', 'Marie Gold Biscuits', 'Britannia', '250 g', 30, 40, 'A8', 'S1'),
  P('muffins', 'bakery-biscuits', 'English Muffins', 'Britannia', '4 pieces', 45, 55, 'A8', 'S1'),
  P('cake', 'bakery-biscuits', 'Chunk Cake', 'Britannia', '120 g', 20, 25, 'A8', 'S2'),
  P('rusk', 'bakery-biscuits', 'Premium Rusk', 'Parle', '300 g', 45, 55, 'A8', 'S2'),
  P('oreo', 'bakery-biscuits', 'Vanilla Creme Biscuits', 'Oreo', '120 g', 30, 40, 'A8', 'S3'),
  P('brown-bread', 'bakery-biscuits', 'Brown Bread', 'Wibs', '400 g', 45, 55, 'A8', 'S3'),
  P('surf', 'home-cleaning', 'Matic Front Load Detergent', 'Surf Excel', '1 kg', 199, 240, 'A9', 'S1'),
  P('vim', 'home-cleaning', 'Dishwash Bar', 'Vim', '300 g', 30, 40, 'A9', 'S1'),
  P('lizol', 'home-cleaning', 'Floor Cleaner (Citrus)', 'Lizol', '500 ml', 99, 125, 'A9', 'S2'),
  P('harpic', 'home-cleaning', 'Toilet Cleaner', 'Harpic', '500 ml', 85, 105, 'A9', 'S2'),
  P('garbage-bags', 'home-cleaning', 'Garbage Bags (Medium)', 'Origami', '30 pieces', 79, 99, 'A9', 'S3'),
  P('scrub', 'home-cleaning', 'Scrub Pad', 'Scotch-Brite', '3 pieces', 45, 60, 'A9', 'S3'),
  P('dettol', 'personal-care', 'Bathing Soap', 'Dettol', '125 g', 45, 55, 'A10', 'S1'),
  P('colgate', 'personal-care', 'MaxFresh Toothpaste', 'Colgate', '150 g', 95, 115, 'A10', 'S1'),
  P('dove', 'personal-care', 'Hair Fall Rescue Shampoo', 'Dove', '340 ml', 245, 299, 'A10', 'S2'),
  P('nivea', 'personal-care', 'Body Lotion', 'Nivea', '200 ml', 199, 250, 'A10', 'S2'),
  P('gillette', 'personal-care', 'Guard Razor', 'Gillette', '1 piece', 99, 120, 'A10', 'S3'),
  P('whisper', 'personal-care', 'Ultra Sanitary Pads', 'Whisper', '20 pieces', 199, 230, 'A10', 'S3'),
  P('pampers', 'baby-care', 'Pants Diapers (M)', 'Pampers', '20 pieces', 399, 499, 'A11', 'S1'),
  P('baby-powder', 'baby-care', 'Baby Powder', "Johnson's", '200 g', 145, 175, 'A11', 'S1'),
  P('cerelac', 'baby-care', 'Wheat Apple Cereal', 'Cerelac', '300 g', 199, 235, 'A11', 'S2'),
  P('wipes', 'baby-care', 'Baby Wipes', 'Himalaya', '72 pieces', 149, 199, 'A11', 'S2'),
  P('pedigree', 'pet-care', 'Adult Dog Food (Chicken)', 'Pedigree', '1.2 kg', 349, 420, 'A12', 'S1'),
  P('whiskas', 'pet-care', 'Cat Food (Tuna)', 'Whiskas', '1.2 kg', 399, 480, 'A12', 'S1'),
  P('drools', 'pet-care', 'Focus Puppy Food', 'Drools', '1 kg', 299, 360, 'A12', 'S2')
];

export const STORES = [
  {
    id: 'saathi-koramangala', name: 'Saathi Kirana — Koramangala',
    address: '80 Feet Road, 4th Block, Koramangala', city: 'Bengaluru', pincode: '560034',
    lat: 12.9352, lng: 77.6245, radius_km: 3, prep_time_minutes: 8
  },
  {
    id: 'saathi-hsr', name: 'Saathi Kirana — HSR Layout',
    address: '27th Main, Sector 1, HSR Layout', city: 'Bengaluru', pincode: '560102',
    lat: 12.9116, lng: 77.6389, radius_km: 3, prep_time_minutes: 10
  }
];

export const SEED_USERS = [
  { phone: '+919000000001', role: 'admin', name: 'Ops Admin' },
  { phone: '+919000000002', role: 'picker', name: 'Picker — Koramangala', store: 'saathi-koramangala' },
  { phone: '+919000000003', role: 'picker', name: 'Picker — HSR', store: 'saathi-hsr' },
  { phone: '+919000000011', role: 'rider', name: 'Arjun (Rider)', store: 'saathi-koramangala', lat: 12.936, lng: 77.625 },
  { phone: '+919000000012', role: 'rider', name: 'Meena (Rider)', store: 'saathi-koramangala', lat: 12.934, lng: 77.623 },
  { phone: '+919000000013', role: 'rider', name: 'Vikram (Rider)', store: 'saathi-hsr', lat: 12.912, lng: 77.6395 },
  { phone: '+919000000021', role: 'customer', name: 'Demo Customer' }
];

export const COUPONS = [
  { code: 'WELCOME50', description: '₹50 off your first order above ₹199', type: 'flat', value: 5000, min_order_minor: 19900, max_discount_minor: 5000, per_user_limit: 1, usage_limit: 10000 },
  { code: 'SAVE10', description: '10% off up to ₹75 on orders above ₹299', type: 'percent', value: 10, min_order_minor: 29900, max_discount_minor: 7500, per_user_limit: 5, usage_limit: 10000 },
  { code: 'FREESHIP', description: 'Free delivery on orders above ₹149', type: 'free_delivery', value: 0, min_order_minor: 14900, max_discount_minor: 0, per_user_limit: 10, usage_limit: 10000 }
];

export function seedV2(db) {
  const now = isoNow();
  const insertStore = db.prepare(`INSERT INTO stores
    (id,name,address,city,pincode,lat,lng,radius_km,timezone,is_open,accepting_orders,prep_time_minutes,
     min_order_minor,delivery_base_fee_minor,delivery_per_km_minor,free_delivery_above_minor,handling_fee_minor,
     surge_fee_minor,surge_active,rider_payout_minor,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'Asia/Kolkata',1,1,?,0,2500,800,19900,900,1500,0,3500,1,?,?)`);
  for (const s of STORES) insertStore.run(s.id, s.name, s.address, s.city, s.pincode, s.lat, s.lng, s.radius_km, s.prep_time_minutes, now, now);

  const insertCategory = db.prepare('INSERT INTO categories (id,name,sort_order) VALUES (?,?,?)');
  for (const c of CATEGORIES) insertCategory.run(c.id, c.name, c.sort);

  const insertProduct = db.prepare(`INSERT INTO products
    (id,store_id,category_id,name,brand,unit,description,image_url,mrp_minor,price_minor,on_hand,reserved,
     aisle,shelf,max_per_order,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'',?,?,?,0,?,?,10,1,?,?)`);
  for (const store of STORES) {
    PRODUCTS.forEach((p, index) => {
      const stock = store.id === 'saathi-koramangala' ? 15 + (index % 5) * 6 : 10 + (index % 4) * 5;
      insertProduct.run(`${p.id}`, store.id, p.category, p.name, p.brand, p.unit,
        `${p.brand} ${p.name} — ${p.unit}. Everyday essential, quality checked.`,
        p.mrp_minor, p.price_minor, stock, p.aisle, p.shelf, now, now);
    });
  }

  const insertUser = db.prepare('INSERT INTO users (id,phone,role,name,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)');
  const insertStaff = db.prepare('INSERT INTO store_staff (store_id,user_id,role) VALUES (?,?,?)');
  const insertRider = db.prepare(`INSERT INTO riders (user_id,home_store_id,is_online,lat,lng,vehicle,active,created_at,updated_at)
    VALUES (?,?,0,?,?,'bike',1,?,?)`);
  for (const u of SEED_USERS) {
    const id = `usr-${u.phone.slice(-10)}`;
    insertUser.run(id, u.phone, u.role, u.name, now, now);
    if (u.role === 'picker') insertStaff.run(u.store, id, 'picker');
    if (u.role === 'rider') insertRider.run(id, u.store, u.lat, u.lng, now, now);
    if (u.role === 'customer') {
      db.prepare(`INSERT INTO addresses (id,user_id,label,receiver_name,receiver_phone,line1,line2,city,pincode,lat,lng,is_default,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
        .run('addr-demo-home', id, 'Home', u.name, u.phone, '123, 5th Block, Koramangala', 'Near Jyoti Nivas College', 'Bengaluru', '560034', 12.939, 77.621, now, now);
    }
  }

  const insertCoupon = db.prepare(`INSERT INTO coupons
    (id,code,description,type,value,min_order_minor,max_discount_minor,starts_at,ends_at,usage_limit,per_user_limit,used_count,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,1,?)`);
  for (const c of COUPONS)
    insertCoupon.run(`cpn-${c.code.toLowerCase()}`, c.code, c.description, c.type, c.value, c.min_order_minor,
      c.max_discount_minor, '2026-01-01T00:00:00.000Z', '2027-12-31T23:59:59.000Z', c.usage_limit, c.per_user_limit, now);
}