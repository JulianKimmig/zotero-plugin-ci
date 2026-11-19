/** Bootstrap native dependencies only on the pipeline's supported Ubuntu x64 runner. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLinuxPrerequisites, parseUbuntuRelease } from '../src/linux-prerequisites.mts';
assert.ok(process.platform === 'linux' && process.arch === 'x64', 'Native prerequisites require Linux x64');
assert.equal(process.argv.length, 2, 'install-linux accepts no arguments');
const suite = parseUbuntuRelease(await readFile('/etc/os-release', 'utf8'));
await installLinuxPrerequisites(await mkdtemp(join(tmpdir(), 'zotero-ci-apt-')), suite);
