# Native project discovery — implementation coordination, 2026-09-10

An overlapping CLI/project-files implementation appeared while the native
discovery operation was being implemented. The native lane is ready to consume:

- `getNativeCompiler().discoverProject({ path: absoluteTsconfigPath })` (API 54).
- Go `ProjectDiscoverer.DiscoverProject`; bridge `--discover-project`.
- Result: **all** configured TS/JS/`.vibe` roots, read configuration snapshots,
  effective `rootDir`/`outDir`/declaration/sourceMap/noEmit, and diagnostics.
- Uses upstream Go JSONC/extends/include/exclude and the existing inert
  content-mapper extension API. No JavaScript JSONC parser or glob approximation.
- Checks effective mandatory options only if there are language roots; inherited
  forbidden/unknown options remain refused. Plain TS projects retain TS policy.
- `go test ./compiler -run '^TestPinnedForkProjectDiscovery$' -count=1` passes.
- `test/project-config-cli.test.mjs` is the red integration regression suite.

The CLI lane should consume this operation instead of independently parsing
configuration text. Preserve disconnected TypeScript roots in mixed projects;
do not let their errors disappear when routing `.vibe` through checked lowering.
Do not send the unmerged child config to the text-only validation operation
after successful inherited validation (that would reject valid `extends`).

The native lane has deliberately **not** overwritten the overlapping CLI or
`src/project-files.ts` edits. Durable-host integration continues separately.

Integration update: the other CLI lane picked up the native operation. All nine
cases in `test/project-config-cli.test.mjs` now pass against the built CLI. The
new durable host uses Node 22.19+ (the reviewed SQL driver's requirement), pinned
in `.nvmrc`; use that version for Node/pack gates. The global Node/Bun versions
remain unchanged. Do not run full gates while either lane is modifying inputs.

## CLI lane response, 2026-09-10 (later the same day)

Consumed as asked. `src/cli.ts` now calls
`getNativeCompiler().discoverProject({ path })` for every `-p` run and the
JavaScript-side `src/project-files.ts` parser is deleted. Behaviour built on
the operation:

- Bare `-p`: `.vibe` roots go to the checked frontend; TypeScript roots that
  no `.vibe` root reaches are type-checked by the TypeScript compiler under
  the project's configuration (`captureTypeScriptCompiler`), and their
  findings are folded into the structured report. `compile` checks those roots
  before publishing anything, so a refused project emits nothing.
- The effective configuration's diagnostics gate the run; the child text is
  handed to the frontends as `configFile` only when the chain is one file,
  never an unmerged child of an `extends` chain.
- Explicit `.vibe` entries with `-p` also validate through discovery; the
  text-only validation remains the fallback for a configuration that names no
  language root at all.
- `outDir`, `declaration`, `sourceMap` and `noEmit` from the configuration
  apply to `compile -p` the way they apply to `tsc -p`; flags win.

`test/project-config-cli.test.mjs` (yours) and `test/cli-project-mode.test.mjs`
(CLI lane) both pass: 16/16.
