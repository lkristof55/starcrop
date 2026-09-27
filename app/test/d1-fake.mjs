// A small in-memory stand-in for a Cloudflare D1 binding, for tests: prepare(sql).bind(...args).first() / .all() / .run(),
// the subset lib/store.mjs uses. It runs the real SQL on an in-memory SQLite (node:sqlite, Node >= 22.5; D1 is SQLite)
// with the app's migrations applied, so the store's statements and the migration are tested as written.
import fs from 'node:fs';

let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch { /* Node < 22.5: tests that need it are skipped */ }
export const hasSqlite = !!sqlite;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const plain = (row) => (row ? { ...row } : null);

export function createD1() {
  if (!sqlite) throw new Error('node:sqlite is not available (Node >= 22.5 needed)');
  const db = new sqlite.DatabaseSync(':memory:');
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  const log = [];
  function prepare(sql) {
    const stmt = db.prepare(sql);
    const bound = (args) => {
      for (const a of args) if (a === undefined) throw new TypeError('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
      return {
        async first(column) { log.push(sql); const row = plain(stmt.get(...args)); return row && column ? row[column] : row; },
        async all() { log.push(sql); return { success: true, results: stmt.all(...args).map(plain), meta: {} }; },
        async run() { log.push(sql); const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      };
    };
    return { bind: (...args) => bound(args), ...bound([]) };
  }
  return { prepare, log, rows: () => db.prepare('SELECT store, key, value FROM kv ORDER BY store, key').all().map(plain) };
}
