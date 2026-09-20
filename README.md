# pnpm 12 dedupe convergence-override performance reproduction

This repository demonstrates a pnpm 12.5.1 `pnpm dedupe` performance regression
using public npm packages from pnpm's `alotta-files` benchmark.

The fixture contains two equivalent projects:

- `v11/` uses `packageManager: "pnpm@11.25.0"` and a pnpm 11 lockfile.
- `v12/` uses `packageManager: "pnpm@12.5.1"` and a pnpm 12 lockfile.

Both projects contain the same public dependencies and 71 convergence
overrides pinned to versions available from the configured registry. Their
project files differ only in the `packageManager` version.

## Why this uses Azure Artifacts

Both fixtures use this public Azure Artifacts feed:

```ini
registry=https://ms-feed-12.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/
```

Azure Artifacts does not provide effective ETag/If-Modified-Since revalidation
and ignores abbreviated npm packument requests. The larger, slower metadata
responses compound the cost of pnpm 12.5.1 checking convergence overrides
serially.

See
[pnpm resolution performance: npmjs vs Azure Artifacts](https://github.com/astegmaier/playground-pnpm-ado-benchmarks)
for a separate reproduction of those registry behaviors.

## Run the reproduction

Requirements: Node.js and pnpm installed directly, not through Corepack.
pnpm reads each fixture's `packageManager` field and runs the requested
version.

From the repository root, run pnpm 11:

```sh
cd v11
pnpm --version
time pnpm dedupe --lockfile-only
```

Then run pnpm 12:

```sh
cd ../v12
pnpm --version
time pnpm dedupe --lockfile-only
```

The version commands should print:

```text
11.25.0
12.5.1
```

Two representative runs on September 19, 2026:

```text
pnpm 11.25.0:  6.89s /  9.21s
pnpm 12.5.1: 23.80s / 24.15s
```

ADO latency varies, so exact timings will change. Run each command several
times if necessary. pnpm 12.5.1 should consistently spend substantially longer
checking the same convergence overrides. The lockfiles remained byte-identical
across the measured runs.

## What the fixture exercises

After full dependency resolution, pnpm checks whether each convergence
override can be raised while still satisfying every declared range.

pnpm 11 overlaps checks for different overrides. pnpm 12.5.1 processes the
overrides one at a time, paying the registry latency separately for each
override. The two projects otherwise resolve the same public dependency
fixture through the same registry.
