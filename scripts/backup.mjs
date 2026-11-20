// Consistent SQLite backup via VACUUM INTO (safe on a live WAL database).
// Usage: node scripts/backup.mjs [output-dir]   (default: ./backups)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

const outDir = resolve(process.argv[2] || 'backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const targets = [
  ['kirana', process.env.KIRANA_DB_PATH || resolve('data/kirana.sqlite')],
  ['kirana-delivery', process.env.KIRANA_V2_DB_PATH || resolve('data/kirana-delivery.sqlite')]
];

for (const [name, path] of targets) {
  const db = new DatabaseSync(path, { readOnly: true });
  const file = join(outDir, `${name}-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  db.close();
  console.log(`backed up ${path} -> ${file} (${statSync(file).size} bytes)`);
}

// Retention: keep the 14 most recent backups per database.
for (const [name] of targets) {
  const files = readdirSync(outDir).filter(f => f.startsWith(`${name}-`) && f.endsWith('.sqlite')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 14))) {
    unlinkSync(join(outDir, old));
    console.log(`pruned ${old}`);
  }
}