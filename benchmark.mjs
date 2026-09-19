import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const registry = spawn(process.execPath, [path.join(root, 'registry.mjs')], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'inherit'],
});
await once(registry.stdout, 'data');

async function resetStats() {
  await fetch('http://127.0.0.1:4873/reset');
}

async function stats() {
  return fetch('http://127.0.0.1:4873/stats').then((response) => response.json());
}

async function invoke(version, directory, executable, stdio) {
  const command = executable ?? 'corepack';
  const args = executable
    ? ['--dir', path.join(root, directory), 'dedupe', '--lockfile-only', '--reporter=append-only']
    : [
        `pnpm@${version}`,
        '--dir',
        path.join(root, directory),
        'dedupe',
        '--lockfile-only',
        '--reporter=append-only',
      ];
  const child = spawn(command, args, { stdio });
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`${command} exited with code ${code}`);
  }
}

async function run(label, version, directory, executable) {
  await invoke(version, directory, executable, 'ignore');
  await resetStats();
  const started = performance.now();
  await invoke(version, directory, executable, 'inherit');
  const elapsedSeconds = (performance.now() - started) / 1000;
  const requestStats = await stats();
  console.log(
    `${label}: ${elapsedSeconds.toFixed(2)}s, ${requestStats.totalRequests} metadata requests, peak concurrency ${requestStats.peakRequests}`,
  );
}

try {
  await run('pnpm 11.25.0', '11.25.0', 'v11');
  await run('pnpm 12.5.1', '12.5.1', 'v12', process.env.PNPM12_BIN);
} finally {
  registry.kill('SIGTERM');
}
