/** Exercise isolated Ubuntu sources with real apt parsing and external command failures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installLinuxPrerequisites, parseUbuntuRelease, type AptCommand } from '../src/linux-prerequisites.mts';
const exec = promisify(execFile);
const release = 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n';

/** Return a unique scratch directory for one isolated prerequisite invocation. */
async function scratch(): Promise<string> { return mkdtemp(join(tmpdir(), 'ci-apt-test-')); }

test('real apt parses direct signed Ubuntu sources without runner mirror configuration', async () => {
 const root = await scratch();
 const commands: AptCommand[] = [];
 await installLinuxPrerequisites(root, parseUbuntuRelease(release), async command => { commands.push(command); });
 const update = commands[0]!;
 const { stdout } = await exec('apt-get', [...update.args.slice(1), '--print-uris']);
 for (const suite of ['noble', 'noble-updates', 'noble-backports']) {
  assert.ok(stdout.includes(`https://archive.ubuntu.com/ubuntu/dists/${suite}/InRelease`), stdout);
 }
 assert.ok(stdout.includes('https://security.ubuntu.com/ubuntu/dists/noble-security/InRelease'), stdout);
 assert.ok(!stdout.includes('mirror+file:'));
 const sources = await readFile(join(root, 'ubuntu.sources'), 'utf8');
 assert.ok(sources.includes('Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg'));
 assert.ok(!sources.includes('Trusted: yes'));
 assert.ok(update.args.includes('APT::Update::Error-Mode=any'));
 assert.ok(update.args.includes('Acquire::https::Timeout=20'));
 assert.ok(update.args.includes('Acquire::Retries=2'));
 assert.ok(update.args.includes('Acquire::ForceIPv4=true'));
});

test('installs native dependencies only after successful isolated index refresh', async () => {
 const commands: AptCommand[] = [];
 await installLinuxPrerequisites(await scratch(), parseUbuntuRelease(release), async command => { commands.push(command); });
 assert.equal(commands.length, 2);
 assert.equal(commands[0]!.args.at(-1), 'update');
 const install = commands[1]!;
 assert.equal(install.command, 'sudo');
 assert.equal(install.args[0], 'apt-get');
 for (const dependency of ['xvfb', 'xauth', 'libgtk-3-0', 'libdbus-glib-1-2', 'libasound2t64', 'zip', 'unzip', 'xz-utils']) {
  assert.ok(install.args.includes(dependency));
 }
 assert.equal(install.args.find(value => value.startsWith('Dir::Etc::sourcelist=')), commands[0]!.args.find(value => value.startsWith('Dir::Etc::sourcelist=')));
});

test('failed index refresh propagates and never attempts installation', async () => {
 let calls = 0;
 await assert.rejects(installLinuxPrerequisites(await scratch(), parseUbuntuRelease(release), async () => {
  calls++; throw new Error('external apt update exited 100');
 }), /update exited 100/);
 assert.equal(calls, 1);
});

test('failed installation propagates without an alternate source or success result', async () => {
 let calls = 0;
 await assert.rejects(installLinuxPrerequisites(await scratch(), parseUbuntuRelease(release), async () => {
  if (++calls === 2) throw new Error('external apt install exited 100');
 }), /install exited 100/);
 assert.equal(calls, 2);
});

test('accepts quoted Ubuntu release metadata and rejects unsupported hosts', () => {
 assert.equal(parseUbuntuRelease(release), 'noble');
 assert.equal(parseUbuntuRelease('ID="ubuntu"\nVERSION_ID=24.04\nVERSION_CODENAME="noble"\n'), 'noble');
 for (const invalid of ['', 'ID=debian\nVERSION_ID=24.04\nVERSION_CODENAME=noble', release.replace('24.04', '26.04'), release.replace('noble', 'unsafe suite')]) {
  assert.throws(() => parseUbuntuRelease(invalid), /Ubuntu 24.04/);
 }
});

test('rejects relative scratch paths before executing privileged commands', async () => {
 let calls = 0;
 await assert.rejects(installLinuxPrerequisites('relative', 'noble', async () => { calls++; }), /absolute/);
 assert.equal(calls, 0);
});
