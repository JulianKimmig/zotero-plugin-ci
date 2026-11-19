/** Install native Linux dependencies through isolated, signed Ubuntu HTTPS repositories. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/** One privileged apt invocation; arguments remain literal and never pass through a shell. */
export interface AptCommand { command: 'sudo'; args: string[] }

/**
 * Parse the supported host identity.
 * @param contents Raw /etc/os-release text, without shell evaluation.
 * @returns The noble suite; incompatible identities throw before installation.
 */
export function parseUbuntuRelease(contents: string): 'noble' {
 const values = new Map(contents.split('\n').map(line => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1).replace(/^"(.*)"$/, '$1')];
 }));
 assert.ok(values.get('ID') === 'ubuntu' && values.get('VERSION_ID') === '24.04' && values.get('VERSION_CODENAME') === 'noble',
  'Native prerequisites require Ubuntu 24.04 (noble)');
 return 'noble';
}

/**
 * Execute the external package manager with inherited diagnostics.
 * @param command Literal sudo executable and apt arguments, without a shell.
 * @returns Completion after exit zero; spawn failures, exit errors and signals reject.
 */
async function executeApt(command: AptCommand): Promise<void> {
 await new Promise<void>((resolve, reject) => {
  const child = spawn(command.command, command.args, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Ubuntu prerequisites failed: ${code ?? signal}`)));
 });
}

/**
 * Install dependencies using fresh sources/lists under an absolute scratch directory.
 * @param directory Existing unique absolute scratch directory; lists must not already exist.
 * @param suite Validated Ubuntu noble suite for this pipeline's supported runner.
 * @param execute External command boundary, defaulting to real sudo/apt; failures propagate.
 * @returns Completion only after a complete index refresh and package installation succeed.
 */
export async function installLinuxPrerequisites(directory: string, suite: 'noble', execute: (command: AptCommand) => Promise<void> = executeApt): Promise<void> {
 assert.ok(isAbsolute(directory), 'APT scratch directory must be absolute');
 assert.equal(suite, 'noble', 'Native prerequisites require Ubuntu 24.04 (noble)');
 await chmod(directory, 0o755);
 await mkdir(join(directory, 'lists'));
 const sources = join(directory, 'ubuntu.sources');
 const key = 'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg';
 await writeFile(sources, `Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: ${suite} ${suite}-updates ${suite}-backports\nComponents: main universe\n${key}\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu\nSuites: ${suite}-security\nComponents: main universe\n${key}\n`, { flag: 'wx', mode: 0o644 });
 const options = ['Dir::Etc::sourcelist=' + sources, 'Dir::Etc::sourceparts=-', 'Dir::State::lists=' + join(directory, 'lists'),
  'Acquire::Retries=2', 'Acquire::http::Timeout=20', 'Acquire::https::Timeout=20', 'Acquire::ForceIPv4=true', 'APT::Update::Error-Mode=any'];
 const args = ['apt-get', ...options.flatMap(option => ['-o', option])];
 await execute({ command: 'sudo', args: [...args, 'update'] });
 await execute({ command: 'sudo', args: [...args, 'install', '-y', '--no-install-recommends',
  'xvfb', 'xauth', 'libgtk-3-0', 'libdbus-glib-1-2', 'libasound2t64', 'zip', 'unzip', 'xz-utils'] });
}
