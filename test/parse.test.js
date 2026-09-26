import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, findGithubRepo, StarcropError } from '../src/index.js';

test('mint input', () => {
  const t = parseTarget('  64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump ');
  assert.equal(t.kind, 'mint');
  assert.equal(t.mint, '64S9QFTFhrcLWsXWjTBkaWPS4asdcrQGwvVQWxUjpump');
});

test('GitHub URLs: extra path, query, .git and www are ignored', () => {
  for (const u of ['https://github.com/sample-owner-1078/riso-windowseat', 'github.com/sample-owner-1078/riso-windowseat/tree/main/src?x=1',
    'http://www.github.com/sample-owner-1078/riso-windowseat.git', 'https://github.com/sample-owner-1078/riso-windowseat#readme']) {
    const t = parseTarget(u);
    assert.equal(t.kind, 'url');
    assert.equal(t.fullName, 'sample-owner-1078/riso-windowseat', u);
  }
});

test('owner/repo slug', () => {
  assert.deepEqual(parseTarget('AutocratGirder/ClashDesk'), { kind: 'slug', mint: null, owner: 'AutocratGirder', name: 'ClashDesk', fullName: 'AutocratGirder/ClashDesk' });
  assert.equal(parseTarget('a/b.js').fullName, 'a/b.js');
});

test('malformed input is BAD_INPUT', () => {
  for (const bad of ['', '   ', 'hello', 'not a/repo', 'owner_/repo', 'a/..', 'https://github.com/orgs/x', '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl', 'x'.repeat(301), 'https://gitlab.com/a/b']) {
    assert.throws(() => parseTarget(bad), (e) => e instanceof StarcropError && e.code === 'BAD_INPUT' && e.status === 400, JSON.stringify(bad));
  }
});

test('findGithubRepo skips non-repo paths and trims punctuation', () => {
  assert.equal(findGithubRepo('site: https://github.com/sample-owner-0153/bitcoinmachinecode.'), 'sample-owner-0153/bitcoinmachinecode');
  assert.equal(findGithubRepo('https://github.com/sponsors/x and github.com/a/b.git'), 'a/b');
  assert.equal(findGithubRepo('https://github.com/justauser'), null);
  assert.equal(findGithubRepo(null), null);
});
