/** Summary rendering keeps failed/skipped cells visible without granting acceptance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matrixSummary } from '../src/pipeline-summary.mts';
test('every planned cell and its selector aliases appears even without receipts', () => {
 const summary = matrixSummary([{ id: '10-linux', version: '10.0.8', platform: 'linux-x64', selectors: ['10.latest.latest', '10.0.latest'] }], [], { native: 'failure', aggregate: 'skipped' });
 assert.match(summary, /10.latest.latest/); assert.match(summary, /10.0.latest/);
 assert.match(summary, /10.0.8/); assert.match(summary, /linux-x64/); assert.match(summary, /Missing/); assert.match(summary, /failure/);
});
test('summary distinguishes duplicate evidence from successful receipt completion', () => {
 const cells = [{ id: '10-linux', version: '10.0.8', platform: 'linux-x64', selectors: ['10.0.latest'] }];
 const receipt = { cell: { id: '10-linux' }, ok: true };
 assert.match(matrixSummary(cells, [receipt, receipt], {}), /Duplicate/);
 assert.match(matrixSummary(cells, [receipt], {}), /Received/);
});
test('comparison renders alias lifecycle, migration, and diagnostics for successful and missing cells', () => {
 const cells = [
  { id: '10.0.7-linux-x64', version: '10.0.7', platform: 'linux-x64', selectors: ['10.0.latest', '10.latest.latest'] },
  { id: '10.1-linux-x64', version: '10.1', platform: 'linux-x64', selectors: ['10.1.latest'] },
 ];
 const receipts = [{ ok: true, cell: { id: cells[0].id }, phases: ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart', 'migration:initialize', 'migration:seed', 'migration:upgrade', 'migration:restart'] }];
 const url = 'https://github.com/owner/plugin/actions/runs/123#artifacts';
 const summary = matrixSummary(cells, receipts, { native: 'failure', aggregate: 'skipped' }, url);
 assert.match(summary, /Fresh lifecycle/); assert.match(summary, /Migration/);
 const rows = summary.split('\n').filter(row => row.startsWith('| 10.'));
 assert.equal(rows.length, 2);
 assert.match(rows[0], /10.0.latest, 10.latest.latest/); assert.match(rows[0], /Reported complete.*Reported complete/);
 assert.match(rows[1], /Missing.*Unavailable.*Unavailable/);
 assert.ok(rows[0].includes(`[diagnostics-${cells[0].id}](${url})`));
 assert.ok(rows[1].includes(`[diagnostics-${cells[1].id}](${url})`));
 assert.match(summary, /aggregate determines acceptance/);
});
test('duplicate receipts cannot claim reported lifecycle completion', () => {
 const cells = [{ id: 'cell', version: '10.1', platform: 'linux-x64', selectors: ['10.1'] }];
 const receipt = { ok: true, cell: { id: 'cell' }, phases: ['fresh:initialize', 'fresh:roundtrip', 'fresh:restart'] };
 assert.doesNotMatch(matrixSummary(cells, [receipt, receipt], {}, 'https://github.com/owner/plugin/actions/runs/123#artifacts'), /Reported complete/);
});
