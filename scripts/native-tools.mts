/** Stage explicitly configured generated native tools and expose their presence to read-only Actions jobs. */
import { resolve } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.mts';
import { stageNativeTools } from '../src/native-tools.mts';
const root = resolve(process.argv[2]), destination = resolve(process.argv[3]);
const config = await loadConfig(root);
const present = config.schemaVersion === 2 && await stageNativeTools(root, config.nativeTools, destination);
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT required');
await appendFile(process.env.GITHUB_OUTPUT, `present=${present}\n`);
