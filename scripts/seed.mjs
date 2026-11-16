// Provision databases: runs migrations and seeds demo data when empty.
// Usage: node scripts/seed.mjs
// Set KIRANA_V2_SKIP_SEED=true to create schema without demo data.
import { openDatabase } from '../src/db.js';
import { openV2Database } from '../src/v2/db.js';

const v1 = openDatabase(process.env.KIRANA_DB_PATH || 'data/kirana.sqlite');
const v2 = openV2Database(process.env.KIRANA_V2_DB_PATH || 'data/kirana-delivery.sqlite');

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
console.log('pickup  :', count(v1, 'stores'), 'stores,', count(v1, 'products'), 'products');
console.log('delivery:', count(v2, 'stores'), 'stores,', count(v2, 'products'), 'products,',
  count(v2, 'users'), 'users,', count(v2, 'coupons'), 'coupons');
console.log('Demo sign-in phones (OTP printed to server console in dev):');
console.log('  customer +919000000021 | picker +919000000002 / +919000000003');
console.log('  riders   +919000000011 / +919000000012 / +919000000013 | admin +919000000001');
v1.close();
v2.close();