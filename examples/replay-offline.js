// Replay a recorded survey offline: analyze() is pure, so a RawSurvey always gives the same report.
//   node examples/replay-offline.js            (the recorded ClashDesk star farm, 2026-09-25)
//   starcrop owner/repo --raw > raw.json && node examples/replay-offline.js raw.json
import fs from 'node:fs';
import { analyze, renderPlat } from '../src/index.js';

const file = process.argv[2] || new URL('../test/fixtures/raw.planted.clashdesk.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(renderPlat(analyze(raw)));
