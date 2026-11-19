/** Always-run, read-only matrix comparison, including cells with missing/failed native evidence. */
import { appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readJSON, readReceipts } from '../src/pipeline-io.mts';
import { matrixSummary } from '../src/pipeline-summary.mts';
import type { PreparedState } from '../src/pipeline-prepare.mts';
let cells: { id: string; version: string; platform: string; selectors: string[] }[] = [];
let receipts: unknown[] = [];
try {
 const prepared = await readJSON(join(resolve(process.argv[2]), 'prepared.json')) as PreparedState;
 cells = prepared.resolution.targets.map(target => ({ id: target.id, version: target.version, platform: target.platform, selectors: target.selectors }));
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
try { receipts = await readReceipts(resolve(process.argv[3])); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY required');
const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
if (!server || !repo || !run) throw new Error('Workflow run URL identity required');
const diagnosticsURL = `${server}/${repo}/actions/runs/${run}#artifacts`;
await appendFile(process.env.GITHUB_STEP_SUMMARY, matrixSummary(cells, receipts, { prepare: process.env.PREPARE_RESULT ?? 'unknown', build: process.env.BUILD_RESULT ?? 'unknown', native: process.env.NATIVE_RESULT ?? 'unknown', aggregate: process.env.AGGREGATE_RESULT ?? 'unknown' }, diagnosticsURL));
