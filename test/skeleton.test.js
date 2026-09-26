import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readmeSkeleton, analyze } from '../src/index.js';
import { sha1Hex } from '../src/sha1.js';
import { load } from './helpers.js';

test('sha1Hex matches node:crypto', () => {
  for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'hello\nworld {v} {name}']) {
    assert.equal(sha1Hex(s), createHash('sha1').update(s).digest('hex'), `len ${s.length}`);
  }
});

test('recorded README: the fixture keeps the skeleton of the original text (dd1114ef5ebd) and analyze() uses it', () => {
  const raw = load('raw.grown.riso-windowseat.json');
  const key = raw.repo.fullName;
  assert.equal(raw.readmes[key].skeleton, 'dd1114ef5ebd');
  assert.equal(analyze(raw).siblings.repos.find((x) => x.fullName === key).skeleton, 'dd1114ef5ebd');
});

test('recorded README (logins replaced): the owner is normalized away, a third-party link is not', () => {
  const raw = load('raw.grown.riso-windowseat.json');
  const key = raw.repo.fullName, [owner, name] = key.split('/');
  const text = raw.readmes[key].text;
  assert.ok(text.length > 10000);
  const sk = readmeSkeleton(text, { owner, name, description: null });
  assert.equal(sk, '36bf41cacf4f');
  assert.equal(readmeSkeleton(text.replaceAll(owner, 'someone-else'), { owner: 'someone-else', name }), sk);
  // why the fixture pins the recorded skeleton: rewriting a linked account in the text changes the hash
  assert.notEqual(readmeSkeleton(text.replace(/sample-owner-\d+\/anidoodle/, 'x/anidoodle'), { owner, name }), sk);
});

test('template twins: only name, owner, description, emoji and version differ', () => {
  const tpl = (emoji, name, owner, desc, v) => `# ${emoji} ${name}\n\n${desc}\n\nGet the latest build from Releases: ${name}-${v}.zip\n\ngit clone https://github.com/${owner}/${name}`;
  const a = readmeSkeleton(tpl('🚀', 'ClashDesk', 'AutocratGirder', 'Modern proxy client', 'v2.2.4'), { owner: 'AutocratGirder', name: 'ClashDesk', description: 'Modern proxy client' });
  const b = readmeSkeleton(tpl('⚡', 'ZedLite', 'centralcashierboost', 'Lightweight editor', '1.0.3'), { owner: 'centralcashierboost', name: 'ZedLite', description: 'Lightweight editor' });
  const c = readmeSkeleton('# ZedLite\n\nA real editor with real docs.', { owner: 'x', name: 'ZedLite' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{12}$/);
});
