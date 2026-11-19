/** Execute plugin-owned npm adapters only in unprivileged build jobs. */
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
/** Construct a shell-free npm invocation; Windows executes npm-cli with the selected Node binary. */
export function npmInvocation(platform: NodeJS.Platform, executable: string, script: string, args: string[]): { command: string; args: string[] } {
 const trailing = ['run', script, '--', ...args];
 return platform === 'win32' ? { command: executable, args: [win32.join(win32.dirname(executable), 'node_modules/npm/bin/npm-cli.js'), ...trailing] } : { command: 'npm', args: trailing };
}
/** Run a declared npm script with literal arguments, inherited logs, and explicit environment. */
export async function runScript(root: string, script: string, args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const invocation = npmInvocation(process.platform, process.execPath, script, args);
    const child = spawn(invocation.command, invocation.args, { cwd: root, env: environment, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`npm ${script} failed: ${code ?? signal}`)));
  });
}
