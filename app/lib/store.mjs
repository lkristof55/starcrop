// Key-value JSON store with three backends, same semantics everywhere:
//   - Cloudflare D1 when a D1 binding is registered (worker.mjs calls useD1(env.DB) before any handler runs);
//   - a folder of JSON files locally (scripts/dev.mjs sets LOCAL_STORE_DIR=app/.data; tests can call useStoreDir(tmp));
//   - Netlify Blobs otherwise (production on Netlify). Never set LOCAL_STORE_DIR on Netlify.
//   const s = await getStore('scans'); await s.setJSON('k', v); await s.get('k'); await s.list({ prefix: 'a/' })
const stores = new Map();
let baseDir = process.env.LOCAL_STORE_DIR || null;
let d1 = null;

export function useStoreDir(dir) { baseDir = dir; d1 = null; stores.clear(); }

/** Use a Cloudflare D1 binding (table `kv`, migrations/0001_kv.sql) for every store. Idempotent; pass null to unregister. */
export function useD1(db) { if (db !== d1) { d1 = db || null; stores.clear(); } }

/** D1 rejects a row over 2,000,000 bytes; a value may use this much and leave room for the key. */
export const D1_MAX_VALUE_BYTES = 1_900_000;

/** A clear error instead of D1's generic one. Cheap: only values that could be that big get UTF-8 encoded. */
function checkSize(name, k, text) {
  if (text.length * 3 <= D1_MAX_VALUE_BYTES) return;
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > D1_MAX_VALUE_BYTES) throw new Error(`store ${name}: ${k} is ${bytes} bytes, over the ${D1_MAX_VALUE_BYTES}-byte limit of a D1 row`);
}

function d1Store(db, name) {
  return {
    async get(k) {
      const row = await db.prepare('SELECT value FROM kv WHERE store = ?1 AND key = ?2').bind(name, k).first();
      return row ? JSON.parse(row.value) : null;
    },
    async setJSON(k, v) {
      const text = JSON.stringify(v);
      checkSize(name, k, text);
      await db.prepare('INSERT INTO kv (store, key, value, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (store, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind(name, k, text, Date.now()).run();
    },
    async delete(k) {
      await db.prepare('DELETE FROM kv WHERE store = ?1 AND key = ?2').bind(name, k).run();
    },
    // A literal prefix: substr() compares characters, so % and _ in the prefix are not wildcards (LIKE would treat them so).
    async list({ prefix = '' } = {}) {
      const { results } = await db.prepare('SELECT key FROM kv WHERE store = ?1 AND key >= ?2 AND substr(key, 1, length(?2)) = ?2 ORDER BY key')
        .bind(name, prefix).all();
      return { blobs: (results || []).map((r) => ({ key: r.key })) };
    },
  };
}

function fileStore(dir) {
  const ready = (async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(dir, { recursive: true });
    return { fs, path };
  })();
  const file = async (k) => { const { path } = await ready; return path.join(dir, encodeURIComponent(k) + '.json'); };
  return {
    async get(k) { const { fs } = await ready; try { return JSON.parse(await fs.readFile(await file(k), 'utf8')); } catch { return null; } },
    async setJSON(k, v) { const { fs } = await ready; const f = await file(k); await fs.writeFile(f + '.tmp', JSON.stringify(v)); await fs.rename(f + '.tmp', f); },
    async delete(k) { const { fs } = await ready; await fs.rm(await file(k), { force: true }); },
    async list({ prefix = '' } = {}) {
      const { fs } = await ready;
      const names = await fs.readdir(dir);
      return { blobs: names.filter((n) => n.endsWith('.json')).map((n) => ({ key: decodeURIComponent(n.slice(0, -5)) })).filter((b) => b.key.startsWith(prefix)) };
    },
  };
}

export async function getStore(name) {
  if (stores.has(name)) return stores.get(name);
  let s;
  if (d1) {
    s = d1Store(d1, name);
  } else if (baseDir) {
    const path = await import('node:path');
    s = fileStore(path.join(baseDir, name));
  } else {
    const { getStore: blobs } = await import('@netlify/blobs');
    const b = blobs({ name, consistency: 'strong' });
    s = { get: (k) => b.get(k, { type: 'json' }), setJSON: (k, v) => b.setJSON(k, v), delete: (k) => b.delete(k), list: (o) => b.list(o) };
  }
  stores.set(name, s);
  return s;
}
