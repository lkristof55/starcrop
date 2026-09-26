import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
export const clone = (x) => JSON.parse(JSON.stringify(x));
