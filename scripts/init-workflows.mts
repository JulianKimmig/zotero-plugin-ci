/** Materialize pinned thin caller templates; refuse to overwrite existing workflows. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { callers } from '../src/github-callers.mts';
const [repository, commit, destination] = process.argv.slice(2);
if (!repository || !commit || !destination) throw new Error('Usage: init-workflows.mts OWNER/SHARED COMMIT PLUGIN_ROOT');
const workflows = callers(repository, commit);
const folder = resolve(destination, '.github/workflows');
await mkdir(folder, { recursive: true });
for (const [name, content] of Object.entries(workflows)) await writeFile(join(folder, name), content, { flag: 'wx' });
