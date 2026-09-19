# pnpm 12 dedupe convergence-override performance reproduction

This repository isolates a pnpm 12.5.1 `pnpm dedupe` regression that becomes
very expensive when a project has many [convergence overrides][convergence].
pnpm 11 checks those overrides concurrently. pnpm 12.5.1 checks each override
serially, so registry latency is paid once per override instead of once per
network-concurrency wave.

The fixture contains two equivalent projects:

- `v11/` uses `packageManager: "pnpm@11.25.0"` and a pnpm 11 lockfile.
- `v12/` uses `packageManager: "pnpm@12.5.1"` and a pnpm 12 lockfile.

Their dependencies, workspace settings, and registry configuration are
otherwise identical. Each project has 48 direct dependencies and 48
convergence overrides.

## Run the reproduction

Requirements: Node.js with Corepack available.

```sh
corepack enable
node benchmark.mjs
```

`benchmark.mjs` starts the included local registry, warms each version's
metadata cache once, and then measures:

```sh
pnpm dedupe --lockfile-only
```

The registry delays every metadata response by 250 ms and reports the peak
number of simultaneous requests. A representative run on September 19, 2026:

```text
pnpm 11.25.0: 0.52s, 48 metadata requests, peak concurrency 48
pnpm 12.5.1: 12.23s, 48 metadata requests, peak concurrency 1
```

The request count is identical. The difference is scheduling: pnpm 11 overlaps
all 48 requests, while pnpm 12.5.1 awaits 48 groups one after another.

To test a locally built pnpm 12 binary:

```sh
PNPM12_BIN=~/projects/pnpm-fix-v12-dedupe-performance/target/release/pnpm \
  node benchmark.mjs
```

With the fix in `~/projects/pnpm-fix-v12-dedupe-performance`, a representative
run is:

```text
pnpm 11.25.0: 0.50s, 48 metadata requests, peak concurrency 48
pnpm 12.5.1: 0.30s, 48 metadata requests, peak concurrency 48
```

Set `DELAY_MS` to change the simulated registry latency:

```sh
DELAY_MS=500 node benchmark.mjs
```

## Root cause

After a full resolution, pnpm validates each convergence override by resolving
every dependency range collected for that package. This detects an override
whose pinned version can now be raised while still satisfying every declared
range.

The pnpm 11 implementation in
`pnpm11/installing/deps-installer/src/install/warnOnStaleConvergenceOverrides.ts`
uses an outer `Promise.all` over convergence overrides and an inner
`Promise.all` over each override's ranges.

The pnpm 12.5.1 implementation in
`pnpm/crates/package-manager/src/warn_on_stale_convergence_overrides.rs` used
`join_all` for the ranges of one override, but processed the overrides in a
plain `for` loop. Different overrides therefore never overlapped. The fix
constructs all override futures first and awaits them with an outer `join_all`,
matching pnpm 11 while preserving result order.

This is especially costly with Azure DevOps Artifacts. ADO does not provide the
effective conditional-cache behavior available from the public npm registry
and returns full package metadata even when pnpm requests the abbreviated
packument. Each unavoidable metadata lookup is therefore relatively large and
slow. Serializing 71 such override checks in Office-Bohemia produced a
post-resolution stall of about 213 seconds in one instrumented run.

The fix changed the same Office-Bohemia `dedupe --lockfile-only` run from
241.7 seconds to 59.3 seconds. Resolution itself remained about 27 seconds;
the convergence check fell from about 213 seconds to 31 seconds, approximately
the duration of the slowest concurrent ADO response. The resulting lockfile
was byte-identical.

## Why pnpm 12 is faster in the existing registry benchmark

The separate `playground-pnpm-benchmarks` fixture has one importer and no
convergence overrides. It therefore does not enter this serial post-resolution
loop. That benchmark primarily measures ordinary dependency resolution, where
pnpm 12.5.1's stable cached-range fast path avoids almost all registry
revalidation. On that workload pnpm 12 is substantially faster than pnpm 11.

Office-Bohemia combines 256 importers, a large pnpmfile hook, and 71 convergence
overrides. Its ordinary pnpm 12 resolution completed in roughly 27 seconds,
but the v12-only serialization bug then added several minutes of ADO-bound
waiting. Both observations are therefore consistent:

- without convergence overrides, pnpm 12's resolver/cache improvements win;
- with many convergence overrides, pnpm 12.5.1 serializes the remaining
  network requests and loses badly;
- after parallelizing those checks, pnpm 12 is again faster in the observed
  Office-Bohemia runs, subject to normal ADO latency variation.

## Why pnpm 12 reported twice as many reused packages

The `reused` discrepancy is a second, independent issue in full
`pnpm dedupe` runs.

pnpm 12's dedupe resolution observer reports `found_in_store` while resolving.
The materialization phase later reports the same store hits again. In the
Office-Bohemia run:

```text
5227 resolve-time store hits + 4947 materialization store hits = 10174 reused
```

pnpm 11 reports the materialization hits once, producing `reused 4947`. The
larger pnpm 12 number does not mean twice as many packages were usefully reused;
it is cumulative double-reporting. The accompanying fix keeps resolve-time
store reporting for `--lockfile-only` and `--check`, where no materialization
phase exists, but leaves full-install reuse reporting to materialization. This
also avoids thousands of unnecessary store-index lookups during full dedupe.

[convergence]: https://pnpm.io/settings/dependency-resolution#convergence-overrides
