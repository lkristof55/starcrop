// Write the site's recorded data from what the library computes (never by hand):
//   site/src/data/featured.json = lib/reference-report.mjs `report` (analyze() on the recorded ClashDesk fixture)
//   site/src/data/idclock.json  = lib/reference-report.mjs `idclock` (global anchors + the farm's local anchors in one list)
// Run in app/ before `npm run build` whenever lib/reference-report.mjs changes:   node site/tools/featured.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const m = await import(path.join(root, 'lib/reference-report.mjs'));
const report = m.report || m.default;
const data = path.join(root, 'site/src/data');
fs.writeFileSync(path.join(data, 'featured.json'), JSON.stringify(report, null, 1) + '\n');

const ic = m.idclock;
const seen = new Set();
const anchors = [...(ic.anchors || []), ...(ic.local || [])].filter((a) => !seen.has(a.id) && seen.add(a.id)).sort((a, b) => a.id - b.id);
fs.writeFileSync(path.join(data, 'idclock.json'), JSON.stringify({ recordedAt: ic.recordedAt, call: ic.call, source: ic.source, anchors }, null, 1) + '\n');
console.log(`featured.json: ${report.repo.fullName} ${report.verdict} ${report.score}/${report.maxScore}, birth spread IQR ${report.stargazers.birthSpreadMinutes} min · idclock.json: ${anchors.length} anchors (${ic.recordedAt})`);
