# pnpm 12 dedupe convergence-override performance regression

This repository accompanies [pnpm/pnpm#15175](https://github.com/pnpm/pnpm/issues/15175). The issue was fixed by the merged [pnpm/pnpm#15181](https://github.com/pnpm/pnpm/pull/15181).

This repository demonstrates a pnpm 12.5.1 `pnpm dedupe` performance regression
using public packages from pnpm's `alotta-files` benchmark.

The fixture contains two equivalent projects:

- `v11/` uses `packageManager: "pnpm@11.27.0"` and a pnpm 11 lockfile.
- `v12/` uses `packageManager: "pnpm@12.5.1"` and a pnpm 12 lockfile.

Both projects contain the same dependencies and 71 convergence overrides. Their
project files differ only in the `packageManager` version.

## Results

Each cell is the median of five measured warm-cache runs on September 20,
2026. Lower is better.

| Registry | pnpm 11.27.0 | pnpm 12.5.1 | Absolute regression | Percent regression |
|---|---:|---:|---:|---:|
| `registry.npmjs.org` | 3.37s | 3.97s | +0.60s | +17.8% |
| Azure DevOps Artifacts | 7.13s | 23.57s | +16.44s | +230.6% |

Individual measured runs:

| Registry | pnpm 11.27.0 | pnpm 12.5.1 |
|---|---|---|
| `registry.npmjs.org` | 3.65s / 3.36s / 3.42s / 2.85s / 3.37s | 4.21s / 4.34s / 3.38s / 3.57s / 3.97s |
| Azure DevOps Artifacts | 7.75s / 7.13s / 7.02s / 6.52s / 7.57s | 24.32s / 23.25s / 23.57s / 23.90s / 23.57s |

The regression exists with the public npm registry. Azure DevOps is an example
of a slower registry that makes the same serialization bug much more visible.

## Root Cause Analysis

After full dependency resolution, pnpm checks every convergence override to
determine whether its pinned version can be raised while still satisfying all
declared ranges collected for that package.

Both pnpm versions perform the same logical work and issue requests for the
same set of convergence overrides. They differ in how those checks are
scheduled:

- pnpm 11 checks different convergence overrides concurrently. It also checks
  the declared ranges within each override concurrently.
- pnpm 12.5.1 checks the ranges within one override concurrently, but awaits
  that override before starting the next one.

The pnpm 11 implementation uses an outer `Promise.all` over convergence
overrides. The pnpm 12.5.1 implementation uses `join_all` for one override's
ranges but processes the overrides themselves in a sequential `for` loop.

As a result, pnpm 12.5.1 places each override's concurrent range-check batch
sequentially on the critical path, instead of processing those batches
concurrently across overrides. With npmjs, conditional responses keep the
additional cost relatively small, but the regression is still measurable.
With a slower registry such as Azure DevOps Artifacts, the serialized batches
dominate the command's runtime.

## Reproduction and methodology

Requirements: Node.js and pnpm installed directly, not through Corepack. pnpm
reads each fixture's `packageManager` field and runs the requested version.

The checked-in `.npmrc` files use the public Azure DevOps feed. To test npmjs,
change the active `registry=` line in both `.npmrc` files to:

```ini
registry=https://registry.npmjs.org/
```

For each registry, run the following from the repository root.

First measure pnpm 11:

```sh
cd v11
pnpm --version
rm -rf .pnpm-cache
pnpm dedupe --lockfile-only >/dev/null
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
```

Then measure pnpm 12:

```sh
cd ../v12
pnpm --version
rm -rf .pnpm-cache
pnpm dedupe --lockfile-only >/dev/null
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
time pnpm dedupe --lockfile-only
```

The version commands should print:

```text
11.27.0
12.5.1
```

Record the `real` wall-clock time for the five measured runs and report their
median. The unmeasured run warms that registry's metadata cache and settles the
feed-specific lockfile.

Benchmark environment:

- macOS on Apple Silicon with 18 logical CPUs.
- Node.js 24.21.0.
- Command: `pnpm dedupe --lockfile-only`.
- The lockfiles remained unchanged during all measured runs.

`--lockfile-only` keeps package materialization and lifecycle scripts out of
the measurement while still forcing the full dependency resolution and
convergence-override check performed by `pnpm dedupe`.

## Why Azure DevOps amplifies the regression

The checked-in fixtures use this public Azure DevOps Artifacts feed:

```ini
registry=https://ms-feed-12.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/
```

Azure DevOps Artifacts does not provide effective ETag/If-Modified-Since
revalidation and ignores abbreviated npm packument requests. It therefore
returns larger metadata bodies and cannot use the same inexpensive `304 Not
Modified` path as npmjs. These registry limitations are independent of the
pnpm 12 bug, but compound the cost of issuing the request batches serially.

See
[pnpm resolution performance: npmjs vs Azure Artifacts](https://github.com/astegmaier/playground-pnpm-ado-benchmarks)
for a separate reproduction and analysis of those registry behaviors.
