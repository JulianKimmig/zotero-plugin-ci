/** Sanitize retained diagnostics on every runner without uploading native profile directories. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sanitizeDirectory } from '../src/pipeline-io.mts';
const root = resolve(process.argv[2]);
await mkdir(root, { recursive: true });
const path = join(root, 'validation.log');
let log: string;
try { log = await readFile(path, 'utf8'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; log = 'No stage log produced.\n'; }
const keys = ['GITHUB_TOKEN', 'GH_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN'];
const roots = ['HOME', 'USERPROFILE', 'RUNNER_TEMP', 'GITHUB_WORKSPACE'];
await writeFile(path, log);
await sanitizeDirectory(root, keys.map(key => process.env[key] ?? ''), roots.map(key => process.env[key] ?? ''));
