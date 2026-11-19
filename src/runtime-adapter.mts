/** Execute plugin-owned npm adapters only in unprivileged build jobs. */
import { spawn } from 'node:child_process';
/** Run a declared npm script with literal arguments, inherited logs, and explicit environment. */
export async function runScript(root: string, script: string, args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', script, '--', ...args], { cwd: root, env: environment, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`npm ${script} failed: ${code ?? signal}`)));
  });
}
