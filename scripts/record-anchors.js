// Re-record the global id-clock table: GET /user/{id} for a spread of ids (deleted ids are skipped by stepping +1).
//   GITHUB_TOKEN=$(gh auth token) node scripts/record-anchors.js > src/anchors.js
const token = process.env.GITHUB_TOKEN;
const ids = [1_000_000, 10_000_000, 25_000_000, 50_000_000, 75_000_000, 100_000_000, 125_000_000, 150_000_000, 175_000_000, 200_000_000, 225_000_000];
for (let id = 250_000_000; id <= 345_000_000; id += 2_500_000) ids.push(id);
const out = [];
for (const base of ids) {
  for (let id = base; id < base + 8; id++) {
    const r = await fetch(`https://api.github.com/user/${id}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'starcrop', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (r.status === 404) continue;
    if (!r.ok) { console.error(`HTTP ${r.status} at ${id}`); break; }
    const u = await r.json();
    out.push({ id: u.id, createdAt: u.created_at });
    break;
  }
}
console.log(`// Global id-clock anchors: GET /user/{id} -> created_at, recorded ${new Date().toISOString().slice(0, 16)}Z.
// Regenerate with \`GITHUB_TOKEN=$(gh auth token) node scripts/record-anchors.js > src/anchors.js\`.
export const GLOBAL_ANCHORS = [
${out.map((a) => `  { id: ${a.id}, createdAt: '${a.createdAt}' },`).join('\n')}
];`);
