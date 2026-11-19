/** Local CLI admission fails before remote resolution or provisioning on an incompatible host. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { matrixFixture } from './matrix-fixture.mts';
test('local matrix guard rejects foreign platforms before starting preparation', async () => {
 const { root } = await matrixFixture({ platforms: [process.platform === 'win32' ? 'linux-x64' : 'windows-x64'] });
 await assert.rejects(promisify(execFile)(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../scripts/validate.mts', import.meta.url)), root]),
  (error: Error & { stderr?: string }) => /Local validation requires/.test(error.stderr ?? ''));
});
