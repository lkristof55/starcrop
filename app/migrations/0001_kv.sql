-- The table behind lib/store.mjs on Cloudflare D1: one row per (store, key), the value as JSON text.
-- Keys are the same as on Netlify Blobs: report/<owner>/<repo>, fields/index, survey/cursor, ...
CREATE TABLE IF NOT EXISTS kv (
  store TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (store, key)
) WITHOUT ROWID;
