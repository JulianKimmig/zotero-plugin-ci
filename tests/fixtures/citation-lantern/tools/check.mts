/** Validate this local fixture's actual source versions without a native runtime. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(manifest.applications.zotero.id, 'citation-lantern@fixtures.invalid');
console.log('fixture inputs valid');
