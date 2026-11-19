/** Package only this second plugin's real production inputs using the system ZIP tool. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('dist', { recursive: true });
execFileSync('zip', ['-q', '-X', `dist/citation-lantern-${manifest.version}.xpi`,
  'manifest.json', 'bootstrap.js', 'LICENSE', 'content/lantern.css', 'locale/en-US/lantern.ftl']);
