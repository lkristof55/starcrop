// Stand-in for @netlify/blobs in the Cloudflare bundle only (wrangler.jsonc "alias"). lib/store.mjs uses D1 there,
// so this is never called; if it were, it fails loudly instead of pretending to store anything.
export function getStore() {
  throw new Error('@netlify/blobs is not available on Cloudflare Workers: register the D1 binding with useD1(env.DB) (worker.mjs does).');
}
