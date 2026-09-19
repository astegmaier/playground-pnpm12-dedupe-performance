import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const packageCount = 48;
const dependencies = Object.fromEntries(
  Array.from({ length: packageCount }, (_, index) => [
    `perf-package-${index.toString().padStart(2, '0')}`,
    '^1.0.0',
  ]),
);
const overrides = Object.keys(dependencies)
  .map((name) => `  '${name}@': 1.0.0`)
  .join('\n');

for (const [directory, version] of [
  ['v11', '11.25.0'],
  ['v12', '12.5.1'],
]) {
  const projectDir = path.join(root, directory);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pnpm-dedupe-convergence-overrides',
        private: true,
        packageManager: `pnpm@${version}`,
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(projectDir, 'pnpm-workspace.yaml'),
    `packages:\n  - '.'\nminimumReleaseAge: 0\noverrides:\n${overrides}\n`,
  );
  fs.writeFileSync(
    path.join(projectDir, '.npmrc'),
    [
      'registry=http://127.0.0.1:4873/',
      'cache-dir=.pnpm-cache',
      'store-dir=.pnpm-store',
      'verify-store-integrity=false',
      '',
    ].join('\n'),
  );
}
