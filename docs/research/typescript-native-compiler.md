# Native TypeScript compiler: upstream and Effect prior art

> Historical research from before the October 2026 VIP rewrite. This page uses ‘EffectScript’ for the project now called VibeLang and may use ‘VibeLang’ for the earlier design. See the [current specification](../design/src/000-intro.md).

Research for EffectScript. Observed 2026-10-15. GitHub and npm timestamps are UTC.
All reads were non-mutating except a shallow scratch clone (see [Method](#method)).

## Summary

The native (Go) TypeScript compiler is maintained in `microsoft/TypeScript` under `tsc/`, as Go
module `github.com/microsoft/TypeScript/tsc`; `microsoft/typescript-go` is archived, and its README
sends development to `microsoft/TypeScript` (the README does not mention `tsc/`; the TypeScript tree
does). TypeScript 7.0.2 is npm `latest`; `main` is 7.1 development, published nightly as
`typescript@next`, and only `main` has content mappers and the de-"unstable" API that the TypeScript
team promises to keep backward compatible through 7.x. The typescript-go history was imported with
rewritten SHAs, so typescript-go pins (including Effect's 7.0.2 pin `2bd066d`) do not resolve in
`microsoft/TypeScript`. Go enforces `internal` by import-path prefix, which is why effect-tsgo's shim
modules named `github.com/microsoft/typescript-go/shim/...` compile while a module under any other
path fails (reproduced below). The [Effect TypeScript compiler snapshot](https://github.com/Effect-TS/tsgo/tree/431711f645f6e8368efaed5a4fdf0005fc511302) (0.27.1, typescript-go `5b1047d`) is a post-check linter and language-service extension: 23 small patches add
package-level callbacks that Effect packages register from `init()`, and no patch touches emit.
Upstream Effect-TS/tsgo (0.53.1) now pins a `microsoft/TypeScript` submodule at `9eedcb0` and
maintains a second 27-patch stack for it. Recommendation: fork `microsoft/TypeScript` `main` at an
npm-nightly `gitHead`, prove the TypeScript and `.d.ts` ABI with a content mapper before writing Go,
and fork Go only for checker-dependent lowering, with EffectScript code in-tree under
`tsc/internal/` and upstream edits limited to registration hooks.

## Method

- GitHub: `gh repo view`, `gh api` (contents, commits, compare, tags, releases, GraphQL),
  `gh pr view`, `gh issue view`, `gh search`.
- npm: `npm view <pkg> dist-tags|time|exports|gitHead`.
- Clone: `jj git clone --depth 1 --branch main --fetch-tags none https://github.com/microsoft/TypeScript.git`
  into
  `<scratch>/tsgo-research/TypeScript`.
  Its working-copy parent is `0e081d6`, the same `main` SHA the API reported.
- Local checkouts: read files only. Submodule pins came from `.git/modules/typescript-go/HEAD` and
  the GitHub contents API (`type: submodule`). No git CLI.
- Go `internal` demo: disposable modules in
  `<scratch>/tsgo-research/internal-rule-demo`,
  built with go1.26.0, `GOWORK=off`.

---

## Part 1. Maintained upstream of the native compiler

### 1.1 Claim check

| Claim | Verdict | Evidence |
| --- | --- | --- |
| `microsoft/typescript-go` is archived | True | `gh repo view microsoft/typescript-go --json isArchived,description,pushedAt,url` returned `isArchived: true`, description "Staging repo for development of native port of TypeScript", `pushedAt: 2026-08-31T14:21:13Z`, url https://github.com/microsoft/typescript-go. |
| Its README directs development to `microsoft/TypeScript` | True | README at `main` = `89d5d5b2849a0db0957065889ca58536fa6d2e4a` (2026-08-20T06:46:10Z, "Add closure notice and link to original repo (#4919)"): "This Repo Is Closed ... Please continue development and discussion in [the original repo](https://github.com/microsoft/TypeScript)" and "This repo will be permanently archived in September 2026." |
| The native compiler lives under `tsc/` | True, but the README does not say so | `gh api repos/microsoft/TypeScript/contents/` at `main` = `0e081d6fb33dde09e084154a0a4daada31fa5a41` (2026-10-15T23:24:37Z, "Escape quotes in synthesized module specifiers (#64839)") lists `tsc/` (tree `fee38f9870969b730d107826214b578e52f58f82`) containing `cmd/`, `internal/`, `testdata/`, `go.mod`, `go.sum`, `CHANGES.md`, `LICENSE`. Root `go.work`: `go 1.27`, `use (./tools ./tsc)`. |

The last code commit on typescript-go is `16c25522e1230b69b11210cfad066d779e6319ba`
(2026-08-19T22:35:29Z, "Fix test:api on windows (#4917)"). `pushedAt` (2026-08-31) postdates the
last `main` commit; I did not identify which ref was pushed.

### 1.2 How the code moved into `microsoft/TypeScript`

- PR [#63763](https://github.com/microsoft/TypeScript/pull/63763) "Migrate repo to TypeScript 7"
  merged 2026-08-20T04:33:11Z as `6d44e0584a857f3a03794241197fd9c7ff457499`. Parents:
  `b465fdbfe175304d9b977da137b2c178ae1091d3` (last JavaScript-compiler `main` commit, 2026-07-27)
  and `1ca4b278f72ed19674a18e1599a9fc35b035a9ed` (imported Go history).
- Mechanical commits on the imported side, all 2026-08-20: `a78be1b` "Remove the historical
  TypeScript submodule", `28c68f4` "Rename the Go module to github.com/microsoft/TypeScript/tsc",
  `5f647a8` "Apply the TypeScript 7 repository layout", `1ca4b27` "Ignore mechanical TypeScript 7
  migration commits in blame".
- History was rewritten. typescript-go `16c2552` appears in TypeScript as
  `51c91ec1dd16769887153914ed283d96f578155e` "Fix test:api on windows (microsoft/typescript-go#4917)"
  with the identical timestamp. `gh api repos/microsoft/TypeScript/commits/<sha>` returns HTTP 422
  "No commit found" for the typescript-go SHAs `89d5d5b`, `1a6eceb`, and `2bd066d`.
- Consequence: a pin recorded as a typescript-go SHA cannot be fetched from `microsoft/TypeScript`.
  Map it by commit subject and timestamp.

### 1.3 Releases, branches, and npm

| Item | Observed value |
| --- | --- |
| `main` | `0e081d6`, 2026-10-15T23:24:37Z. 7.1 development. `tsc/go.mod`: `go 1.27`. |
| `release-7.0` | `e26ac55408cf43deb4c33e1448f51876d99fa07a`, 2026-10-14T23:37:05Z, "Cherry-pick #64818 into release-7.0 (#64822)". Diverged from `main`: `main` +461, branch +22, merge base `a5a219c3b5da0db4fa0ecf6c0b1f588c9af9c669`. Same `tsc/` layout and module path; `go 1.26`. No `tsc/internal/contentmapper` (contents API 404). |
| `release-6.0` | `050880ce59e30b356b686bd3144efe24f875ebc8`, 2026-04-15, "Bump version to 6.0.3 and LKG" (= tag `v6.0.3`). Last JavaScript-compiler line. |
| Latest tag | `v7.0.2` -> `1e4744d68260a7cb91b62b12edc3f6a2187faaf1` ("Merge branch 'main' into ts7-release", 2026-07-08T04:22:40Z). The GitHub release was published 2026-08-20T18:09:49Z; its body says "This tag was originally released at: https://github.com/microsoft/typescript-go/releases/tag/typescript%2Fv7.0.2", where tag `typescript/v7.0.2` -> `2bd066d87f5bafd315be9f40889d0a60b9e58e0b`. No 7.1 tag exists. |
| npm `typescript` | `latest` 7.0.2 (published 2026-07-08T15:55:18Z; `gitHead` `2bd066d`, a typescript-go SHA). `rc` 7.0.1-rc. `next` 7.1.0-dev.20261015.1 (`gitHead` `257e87406c6a8be277cb8cd5ef8d7b458a650390` = TypeScript `main`, 2026-10-14, "[api] Fix named pipe / UDS creation (#64818)"). `beta` is still 6.0.0-beta: no 7.1 beta is published. |
| npm binaries | `typescript@7.0.2` lists 20 `@typescript/typescript-<os>-<arch>` packages. `bin/tsc` -> `lib/tsc.js` -> `lib/getExePath.js` -> `<platform package>/lib/tsc`. |
| npm `@typescript/native-preview` | `latest` 7.0.0-dev.20260707.2 (2026-07-07, bin `tsgo`), `beta` 7.0.0-dev.20260421.2. No publish since 2026-07-07; nightlies moved to `typescript@next`. Issue [#64565](https://github.com/microsoft/TypeScript/issues/64565) calls it "no longer published". |
| npm `@typescript/typescript6` | 6.0.2, bin `tsc6`. The [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) (2026-07-08) says it "re-exports the TypeScript 6.0 API". |
| JS API exports | 7.0.2: `typescript/unstable/{sync,async,ast,...}`. `next`: `typescript/{sync,async,ast,ast/factory,vscode,fs,path,proto}`. |
| VS Code | `packages/vscode-typescript` = `TypeScriptTeam.native-preview` 1.0.1 (tag `vscode-typescript/v1.0.1`, 2026-09-30). |

Branch policy, from `.github/workflows/` at `0e081d6`: development lands on `main`;
`new-release-branch.yaml` cuts `release-X.Y` (inputs `branch_name`, `package_version`,
`core_major_minor`); `create-cherry-pick-pr.yml` (inputs `pr`, `target_branch`) carries fixes to a
release branch, visible as branch `cherry-pick/64303/release-7.0` and commit `e26ac55`.

7.1 schedule, from [#63703](https://github.com/microsoft/TypeScript/issues/63703) "TypeScript 7.1
Iteration Plan": beta 2026-10-06, RC 2026-11-10, stable 2026-11-24. Its work items include
"Stabilize API: Content Mapper API (typescript-go#4712), Emit API (typescript-go#4699), Language
Service API". The beta date has passed without an npm beta.

### 1.4 Layout of `tsc/` at `0e081d6`

```
microsoft/TypeScript @ 0e081d6
├── go.work                    go 1.27; use ./tools ./tsc
├── Herebyfile.mjs             build, test, lint, generate tasks
├── tsc/                       module github.com/microsoft/TypeScript/tsc
│   ├── cmd/tsc/               one binary: CLI, --lsp, --api
│   ├── internal/              53 top-level packages, table below
│   ├── testdata/              tests/cases/**, baselines/reference/**
│   └── CHANGES.md             intentional differences from TypeScript 6.0
├── tools/                     module github.com/microsoft/TypeScript/tools (custom lint, gen-proto, scripts)
└── packages/
    ├── typescript/            npm "typescript": launcher + JS API client (sync, async, ast, vscode)
    └── vscode-typescript{,-nightly}/   VS Code extension
```

| Stage | Package(s) under `tsc/internal/` | Non-test Go LOC | Notes |
| --- | --- | ---: | --- |
| Scanner | `scanner` | 4,331 | JSDoc tag pre-scan flags |
| Parser | `parser` | 9,137 | |
| AST | `ast` (plus `astnav`) | 25,092 (`ast` only) | `NodeFactory`, visitors, diagnostics type |
| Binder | `binder` | 3,572 | |
| Checker | `checker` | 61,765 | `checker.go` 32,817 lines; `relater.go`, `inference.go`, `flow.go`, `emitresolver.go`, `nodebuilderimpl.go`, `pseudotypenodebuilder.go` |
| Type-to-node | `checker/nodebuilder*.go`, `nodebuilder` (interfaces), `pseudochecker` | | `pseudochecker` gives syntactic "types" for declaration emit |
| Transforms | `transformers/{tstransforms,estransforms,moduletransforms,jsxtransforms,inliners,declarations}` | 24,469 | Declaration emit: `transformers/declarations/transform.go` (3,029 lines) |
| Printer | `printer` | 11,760 | `printer.go`, `emitcontext.go`, `factory.go`, `textwriter.go` |
| Source maps | `sourcemap` (generator, decoder, `source_mapper.go`), `spanmap` | 1,113 + | `spanmap`: virtual-to-original segments for content mappers |
| Program and emit | `compiler` (`program.go`, `emitter.go`, `fileloader.go`), `outputpaths` | 6,788 | `getScriptTransformers` in `compiler/emitter.go` orders the JS transforms |
| Options | `tsoptions` (`options_generated.go`, `declarations_generated.go`), `core` | | Generated from `tools/scripts/tsc/generate-options.ts` |
| Modules | `module`, `modulespecifiers`, `packagejson` | | |
| CLI | `execute`, `execute/{tsc,build,incremental,watchmanager}` | 10,493 | `tsc`, `-b`, `--watch`, `.tsbuildinfo` |
| Language service | `ls` (+ `autoimport`, `change`, `lsconv`, `lsutil`), `format` | 42,314 | |
| LSP server | `lsp` (+ `lsproto`), `project` | 22,377 + 13,039 | |
| API | `api` (+ `encoder`), `ipc`, `jsonrpc` | 14,427 | |
| Content mappers | `contentmapper` | 2,035 | |
| Tests | `testrunner`, `fourslash`, `testutil/*` | | |
| Libraries | `bundled` | | `lib.*.d.ts` embedded unless built with tag `noembed` |

Packages on `main` that the typescript-go pin used by local effect-tsgo (`5b1047d`) lacks:
`contentmapper`, `ipc`, `osutil`, `spanmap`, `transpile`.

### 1.5 Build and distribution

- One binary. `tsc/cmd/tsc/main.go` `runMain`: `--lsp` -> `runLSP` (`lsp.NewServer`; prints "only
  stdio is supported" without `--stdio`), `--api` -> `runAPI` (`api.NewStdioServer`; MessagePack by
  default, `--async` switches to JSON-RPC, `--pipe` for a named pipe or Unix socket,
  `--runExternalCode`), otherwise `execute.CommandLine`.
- Build. `npx hereby build` runs `go build -tags=noembed -o built/local/tsc ./cmd/tsc` in `./tsc`
  with `CGO_ENABLED=0` (`Herebyfile.mjs`, `buildTsc`). Release builds add `-trimpath` and
  `-ldflags=-s -w`, plus `-X github.com/microsoft/TypeScript/tsc/internal/core.version=<v>` when a
  version override is given (`getReleaseBuildFlags`).
- Prerequisites per `CONTRIBUTING.md`: Go 1.27, Node.js 24. Current Go stable is 1.27.2; this Mac
  has go1.26.0.
- Tests. `npx hereby test`; focused: `go -C ./tsc test -run='TestLocal/<name>' ./internal/testrunner`.
  Cases in `tsc/testdata/tests/cases/compiler/`, accepted baselines in
  `tsc/testdata/baselines/reference/`.

### 1.6 Go `internal` rule and the options for a language fork

The Go language spec does not define `internal`; the `go` command does.

- [cmd/go, "Internal packages"](https://pkg.go.dev/cmd/go#hdr-Internal_packages): "Code in or below a
  directory named 'internal' is importable only by code that shares the same import path above the
  internal directory." Design: https://go.dev/s/go14internal. [Go 1.5](https://go.dev/doc/go1.5)
  extended enforcement to all repositories.
- In module mode the check compares import paths, not directories. `cmd/go/internal/load/pkg.go`
  (Go 1.26.0, lines 1548-1561): "p is in a module, so make it available based on the importer's
  import path instead of the file path (https://golang.org/issue/23970)".
- `//go:linkname`: [Go 1.23](https://go.dev/doc/go1.23) blocks pull-only linknames into the
  standard library. The linker check in `cmd/link/internal/loader/loader.go` (`checkLinkname`)
  returns early with `// For now, only check for symbols defined in std` for other packages.

Reproduction (go1.26.0, two separate modules with `replace github.com/microsoft/TypeScript/tsc => ../up`):

```
module github.com/effectscript/compiler            -> main.go:3:8: use of internal package
                                                      github.com/microsoft/TypeScript/tsc/internal/checker not allowed (exit 1)
module github.com/microsoft/TypeScript/tsc/shim/checker -> builds (exit 0)
```

| Option | Mechanism | Cost and risk | Prior art |
| --- | --- | --- | --- |
| Hard fork | Edit the tree directly | Every upstream sync is a merge; full control | None found |
| Patch queue | Ordered `*.patch` applied to a pinned checkout | Re-validate per pin; Effect keeps 23 patches over 24 files locally, 27 per stack upstream | effect-tsgo, baml-tsgo |
| In-tree package | New package under `tsc/internal/<lang>/` plus registration hooks | Legal import of every internal package; compile errors surface upstream API changes | Recommended below |
| Shim modules | Modules named under the upstream prefix (`.../tsc/shim/<pkg>`) plus `replace`; type aliases, `//go:linkname`, `unsafe.Pointer` struct mirrors | Works by the import-path rule; mirrors break silently on layout changes; consumers must copy the `replace` directives | effect-tsgo (1,135 linknames, 24 unsafe sites), oxc tsgolint |
| Official IPC API | `tsc --api`; JS clients `typescript/sync`, `typescript/async` | No internals; queries, diagnostics, emit, `printNode`; no transform or checker hooks | TypeScript team |
| Content mapper | tsconfig `contentMappers`, package manifest `typescript.contentMapper.exec`, `--runExternalCode` | Official foreign-language seam; mapper sees text only; no JS emit for mapped files | `tsc/internal/testutil/contentmappertest/lisp.go` |

### 1.7 Public extension surfaces

- No in-process plugins. `tsc/internal/core/options_generated.go:88`: "Plugins are parsed only so
  tools can report that native TypeScript does not support them." No other non-test package outside
  `contentmapper` mentions plugins.
  In [#63771](https://github.com/microsoft/TypeScript/issues/63771), jakebailey (2025-03-12): "Go is a
  statically compiled language without good plugin support"; RyanCavanaugh (2026-08-20): "I expect
  that emit-side transforms are going to be out of scope going forward".
- IPC API (`tsc/internal/api/proto.go`). Methods include `createSnapshot`, `getTypeAtLocation`,
  `getSymbolAtLocation`, `typeToString`, `isTypeAssignableTo`, `get*Diagnostics`, `emit`,
  `emitToString`, `getJavaScriptEmit`, `getDeclarationEmit`, `printNode` (client-built AST from
  `typescript/ast/factory`), `transpileModule`, `transpileDeclaration`. `EmitParams` carries only
  snapshot, project, and `emitOnly`: no custom transformers.
  [#64709](https://github.com/microsoft/TypeScript/issues/64709) (andrewbranch, 2026-10-09): the
  `/unstable` prefixes are gone; after 7.1 stable, client API changes stay backward compatible during
  7.x; the client/server protocol may change in minor releases; watch, incremental, and build
  orchestrator APIs will not be stable in 7.1.
- Content mappers (`tsc/internal/contentmapper/`, merged 2026-08-19 as typescript-go #4712; `main`
  only). The mapper is a child process speaking JSON-RPC (`initialize`, `transform`). A request
  carries `FileName` and `Content`. A result carries virtual TS `Text`, `VirtualExtension`,
  `Diagnostics`, a `spanmap.SpanMap` with per-segment features (hover, completion, definition,
  rename, code actions, and more), `DiagnosticDirectives`, and `Supplemental` files.
  - Execution requires `--runExternalCode` (schema text: "Execution must be enabled separately with
    --runExternalCode"; LSP `initializationOptions.runExternalCode`).
  - Emit: `compiler/emitter.go` states "Runtime output for content-mapped files is owned by the
    external content mapper or build tool". With `declaration`, tsc emits `.d.ts` and
    `.d.ts.map` mapped to original positions. Baseline
    `tsc/testdata/baselines/reference/compiler/contentMapperOutputExtensions.js`: `Card.astro` with
    `outputExtensions {".astro": ".js"}` emits `Card.d.ts` and rewrites `./Card.astro` imports in
    `.ts` files to `./Card.js`.
  - Stability: "the content mapper protocol will only change in backward-compatible ways during 7.x"
    (#64709). The VS Code setting `js/ts.contentMappers.enabled` is tagged experimental.
    `gh search issues --repo microsoft/TypeScript 'content mapper'` found 15 open and 8 closed issues
    whose titles mention content mappers or content-mapped files, for example
    [#64182](https://github.com/microsoft/TypeScript/issues/64182) and
    [#64641](https://github.com/microsoft/TypeScript/issues/64641).
  - In-process seam inside a fork: `compiler.CompilerHost.GetContentMappedSourceFiles` and the
    `contentmapper.Project` interface (`Transform(mapper, Request) (Result, error)`), implemented by
    `compiler/host.go`, `project/compilerhost.go`, and `execute/build/compilerHost.go`.

| EffectScript need | Content mapper | IPC API | In-tree fork |
| --- | --- | --- | --- |
| Parse EffectScript syntax | Yes, in the mapper | No | Yes |
| Use resolved TS types while lowering | No: request is file name plus content | Only from a separate program | Yes |
| Type-check the generated TypeScript | Yes | Yes | Yes |
| Diagnostics and hovers at EffectScript spans | Yes, via `SpanMap` | Manual | Reuse `spanmap` |
| `.d.ts` plus declaration map | Yes | `getDeclarationEmit` | Yes |
| JavaScript for EffectScript files | No | No | Yes |
| Compatibility promise | Backward compatible in 7.x | Client API backward compatible after 7.1 | None |

---

## Part 2. effect-tsgo (`<external-checkout>/effect-tsgo`)

### 2.1 What it is and which revisions

- "A wrapper around TypeScript-Go that builds the Effect Language Service, providing Effect-TS
  diagnostics and quick fixes", targeting Effect 4 and Effect 3 (`README.md`). It replaces `tsgo`/`tsc`
  rather than running beside it. MIT license (`LICENSE`); TypeScript is Apache-2.0.
- Local checkout: `refs/heads/main` = `431711f645f6e8368efaed5a4fdf0005fc511302` ("ci: reduce
  platform cache usage (#531)", 2026-08-03T17:33:50Z), shallow clone made 2026-08-03
  (`.git/logs/HEAD`), version 0.27.1 (`etscore/version_generated.go`).
- `.gitmodules`: submodule `typescript-go` -> https://github.com/microsoft/typescript-go.git,
  `ignore = dirty`. Pinned gitlink `5b1047d10d32e7d5b446be4de56b126ff42f82bb` (GitHub contents API at
  `431711f`; same in `.git/modules/typescript-go/HEAD`), typescript-go commit 2026-07-31 "Avoid
  temporary composite mapper allocations (#4798)". Module `github.com/microsoft/typescript-go`,
  entry `cmd/tsgo`.
- Pin manifest `_packages/tsgo/upstream.json` (schemaVersion 2): profile `next` = npm
  7.1.0-dev.20260803.1, `gitHead` `5b1047d`, binary `tsc-next`; profile `latest` = 7.0.2, `gitHead`
  `2bd066d`, binary `tsc`; profile `oxlint` = TypeScript 7.0.2 + tsgolint 7.0.2001 (`482dcf7`) +
  oxlint 1.77.0 (`9a423f2`).
- Upstream has moved on. https://github.com/Effect-TS/tsgo `main` = `410f21e8b8724d77a88be1759222b85963398147`
  (2026-10-15T22:16:52Z); release `@effect/tsgo@0.53.1` (2026-10-15). `.gitmodules` now declares
  submodule `typescript` -> https://github.com/microsoft/TypeScript.git at
  `9eedcb0dd7257f8a1a175adbef28f3b6d3492d7a` (TypeScript `main`, 2026-10-14). `upstream.json`
  schemaVersion 5 maps 7.0.2 -> `2bd066d` (provider `typescript-go`) and 7.1.0-dev.20261014.1 ->
  `9eedcb0` (provider `typescript`). Two patch stacks: `_patches/typescript-go/` (27) and
  `_patches/typescript/` (27, paths rooted at `tsc/`). Imports become
  `github.com/microsoft/TypeScript/tsc/shim/...`. 13 upstream-sync commits landed between 2026-09-15
  and 2026-10-15.

### 2.2 Repository mechanics

| Directory | Role |
| --- | --- |
| `typescript-go/` | Pinned upstream checkout, reset and re-patched by `pnpm setup-repo`; never edited directly (`AGENTS.md`). |
| `_patches/typescript-go/*.patch` | 23 patches, applied in bytewise order with `git apply --check` then `git apply` (`_tools/repoctl/src/submodules.ts`, `patchSubmodules`). 683 added non-blank lines over 24 files; 335 of them are fourslash test helpers (patch 010). |
| `_patches/tsgolint/`, `_patches/oxlint/` | Inject Effect rules into oxc's type-aware linter. |
| `shim/<pkg>/` | 44 generated modules named `github.com/microsoft/typescript-go/shim/<pkg>` that re-export internal packages: type aliases, `//go:linkname` function bindings (1,135), and `unsafe.Pointer` mirrors of unexported struct fields (24 sites). Generated by `_tools/gen_shims/main.go` from `packagesToShim` plus `config/*/extra-shim.json` (for example unexported `Checker.isTypeAssignableTo`, `getTypeArguments`, `forEachYieldExpression`). |
| `go.work`, `go.mod` | Workspace joins `.`, `./etscore`, `./typescript-go`, and every shim; `replace` maps shim paths to local directories. |
| `etscore/` | Separate module `github.com/effect-ts/tsgo/etscore` (plugin options, severities, CLI-mode flag, version). The patched typescript-go imports it, so it must not depend on the main module. |
| `etscheckerhooks/` | Registers the after-check diagnostics hook. |
| `etslshooks/` | Registers code fixes, refactors, hover, inlay-hint, completion, document-symbol, and auto-import hooks. |
| `etsexecutehooks/` | Registers the exit-code filter. |
| `etstesthooks/` | Mounts real Effect packages into the fourslash VFS. |
| `etsdiagnostics/` | `--effect-cli-diagnostics <json>` mode behind `effect-tsgo diagnostics` (`_packages/tsgo/src/cli/diagnostics.ts` spawns the binary). |
| `etsrulerunner/` | `RunRule`, `RunRuleAndReport` for external runners; used by generated tsgolint code (`_tools/repoctl/src/codegen.ts`). |
| `etsgoapi/` | Narrow public Go API: `TypeParser` wrapper returning `Effect{A,E,R}`, `Layer{ROut,E,RIn}`, `Service`, `SchemaTypes`. |
| `internal/` | 25 packages, including `typeparser`, `rule`, `rules`, `rulerunner`, `directives`, `pluginoptions`, `effectconfigraw`, `fixable(s)`, `refactor(s)`, `completion(s)`, `codegen(s)`, `layergraph`, `schemagen`, `rewriter`, `autoimportstyle`, `effecttest`, `bundledeffect`, `diagnostics`. Effect Go code in `internal/` plus the `ets*` packages totals about 39k non-test and 12.6k test lines. |

### 2.3 Hook mechanism

Each patch adds a package-level function variable plus a `Register*` setter in an upstream package
and a call site that invokes it when non-nil. Comments state "Only one callback can be registered.
Subsequent calls will replace the previous callback." Effect packages call the setters from
`init()`. Patch `001-cmd-tsgo-main.patch` blank-imports those packages in `cmd/tsgo/main.go`, so
registration runs before `main`.

```
process start
  init() of blank imports (patch 001)
    etscheckerhooks  core.SetVersionSuffix("+effect-tsgo.<ver>")            (patch 021)
                     tsoptions.RegisterMergeCompilerOptionsCallback(...)     (patch 013, via internal/effectconfigraw)
                     checker.RegisterAfterCheckSourceFileCallback(afterCheckSourceFile)   (patch 002)
    etsexecutehooks  tsc.RegisterFilterDiagnosticsForExitCodeCallback(...)  (patch 009)
    etslshooks       ls.RegisterCodeFixProvider / RegisterRefactorProvider / RegisterAfterQuickInfoCallback /
                     RegisterAfterDocumentSymbolsCallback / RegisterAfterInlayHintsCallback /
                     RegisterAfterCompletionCallback; autoimport.RegisterAutoImportFixTransformer
tsconfig "plugins": [{ "name": "@effect/language-service", ... }]
  -> core.CompilerOptions.Effect *etscore.EffectPluginOptions                (patches 007, 013, 025)
diagnostics request for file F -> (*Checker).checkSourceFile(F)              (internal/checker/checker.go, patch 002)
  links.relationErrors = nil
  grammar check, type check
    Relater.reportRelationError appends RelationError{Source, Target, ErrorNode}   (patches 004, 005)
  links.typeChecked = true
  AfterCheckSourceFileCallback(ctx, program, checker, F)
    rulerunner.Run: skip .d.ts and external-library files; resolve per-file options and severity;
      typeparser.NewTypeParser (cache in Checker.EffectLinks, patch 023); run each rule;
      apply @effect-diagnostics directives; c.AddDiagnostic(d)
  unused-identifier checks continue upstream
diagnostics flow unchanged to tsc output, LSP, and .tsbuildinfo
  @ts-ignore / @ts-expect-error never suppress codes 377000-377999       (patch 006, compiler/program.go)
  exit status counts only diagnostics returned by the exit-code filter   (patch 009, execute/tsc/emit.go)
```

| Patch | Upstream file | Adds |
| --- | --- | --- |
| 002 | `internal/checker/checker.go` | `AfterCheckSourceFileCallback`, `(*Checker).AddDiagnostic`, `Program()`, `GetRelationErrors(sf)`; `IsSourceFileFromExternalLibrary` on `checker.Program` |
| 003 | `internal/checker/exports.go` | `GetTypeArgumentsForResolvedSignature` |
| 004, 005 | `internal/checker/relater.go`, `types.go` | `RelationError` capture per source file |
| 023 | `internal/checker/checker.go` | `Checker.EffectLinks any` |
| 006 | `internal/compiler/program.go` | Effect code range ignores TS suppression comments |
| 007, 013, 025 | `internal/core/compileroptions.go`, `internal/tsoptions/*` | `CompilerOptions.Effect`, `plugins` parsing, merge callback with config paths |
| 008 | `internal/diagnostics/generate.go` | Merges `internal/diagnostics/effectDiagnosticMessages.json` (110 messages, codes 377000-377111) |
| 009 | `internal/execute/tsc.go`, `execute/tsc/emit.go` | CLI-mode flag; exit-code filter |
| 010 | `internal/fourslash/fourslash.go` | `PrepareTestFSCallback`; quick-fix and refactor test helpers |
| 011, 017 | `internal/ls/codeactions.go`, `internal/lsp/server.go` | External code-fix and refactor providers; advertises `refactor.rewrite` |
| 012, 015, 022, 024 | `internal/ls/{hover,inlay_hints,completions,symbols}.go` | After-hover, after-inlay-hints, after-completion, after-document-symbols callbacks |
| 018, 027 | `internal/ls/autoimport/*` | Auto-import fix transformer factory |
| 014, 021 | `internal/ast/utilities.go`, `internal/core/version.go` | Nil check; version suffix |

Upstream additions since the local snapshot (Effect-TS/tsgo `410f21e`, `_patches/typescript/`):
`028-incremental-effect-options` (Effect options in `.tsbuildinfo`; option changes invalidate semantic
diagnostics), `030-tsoptions-validation`, `031-stability-tag-fast-path` (scanner and parser flags for
`@stability` JSDoc), `032-vfsmatch-root-include`, and `033-checker-expression-checked-callback`
(`RegisterExpressionCheckedCallback`, called with every `checkExpressionEx` result).

### 2.4 Effect type recognition and A/E/R extraction (`internal/typeparser/`)

- Version: `discover.go` scans the program's source files for `package.json` entries named
  `effect`; a version starting with `3` means v3, `4` means v4, and mixed majors mean unknown.
  Cached per checker. `SupportedEffectVersion` treats unknown as v3.
- Effect (`effect_type.go`): v4 reads the property `~effect/Effect` (`EffectTypeId`) and parses its
  variance struct. v3 or unknown scans required, non-optional properties with a value declaration,
  tries names containing `EffectTypeId` first, and parses each as a variance struct.
- Variance struct (`helpers.go`): `_A`, `_E`, `_R` must each be a single, non-generic call signature;
  the return type is the channel (covariant). Contravariant slots use the first parameter of
  `(_: T) => void`.
- Related shapes: `StrictEffectType` also requires symbol name `Effect` (excludes Stream and Layer);
  `layer_type.go` reads `~effect/Layer` -> `_ROut` (contravariant), `_E`, `_RIn`; `stream_type.go`
  reads `~effect/Stream`; `EffectSubtype` adds `_tag` or `get` (Exit, Option, Either); `FiberType` adds
  `await` and `poll`; v4 `EffectYieldableType` falls back to the return type of `asEffect()`.
- Identity: `IsNodeReferenceToEffectModuleApi(node, "gen")` resolves the node's symbol to an export
  of a module in package `effect` that exports a parsable `Effect` type (`isEffectTypeSourceFile`).
- Relation errors: `missingEffectContext`, `missingEffectError`, and `missingLayerContext` read
  `Checker.GetRelationErrors(sf)`, parse both sides as Effects, and report `R` or `E` members of the
  source that are not assignable to the target (`internal/rules/missing_effect_context.go`).

### 2.5 Diagnostics, quick fixes, refactors, completions

94 rules in `internal/rules/rules.go`, documented in `README.md` and `docs/rules/*.md`:

- Correctness (18): anyUnknownInErrorContext, classSelfMismatch, duplicatePackage,
  effectFnImplicitAny, floatingEffect, floatingEffectInVitest, genericEffectServices,
  missingEffectContext, missingEffectError, missingLayerContext, missingReturnYieldStar,
  missingStarInYieldEffectGen, nonObjectEffectServiceType, outdatedApi, overriddenSchemaConstructor,
  promiseInEffectSuccess, schemaLiteralNonFinite, schemaOpaqueInstanceMember.
- Anti-pattern (20): catchUnfailableEffect, effectFnIife, effectGenUsesAdapter, effectInFailure,
  effectInVoidSuccess, globalErrorInEffectCatch, globalErrorInEffectFailure,
  layerMergeAllWithDependencies, lazyEffect, lazyPromiseInEffectSync, leakingRequirements,
  multipleEffectProvide, preferUnsafeConstructor, returnEffectInGen, runEffectInsideEffect,
  schemaSyncInEffect, scopeInLayerEffect, strictEffectProvide, tryCatchInEffectGen,
  unknownInEffectCatch.
- Effect-native (22): abortControllerInEffect, asyncFunction, cryptoRandomUUID(+InEffect),
  extendsNativeError, globalConsole(+InEffect), globalDate(+InEffect), globalFetch(+InEffect),
  globalRandom(+InEffect), globalTimers(+InEffect), instanceOfSchema, newPromise, nodeBuiltinImport,
  preferSchemaOverJson, processEnv(+InEffect), unsafeEffectTypeAssertion.
- Style (34): catchAllToMapError, catchChainToFirstSuccessOf, catchTagToCatchReason, catchToIgnore,
  catchToOrElseSucceed, deterministicKeys, effectDoNotation, effectFnOpportunity, effectMapFlatten,
  effectMapVoid, effectSucceedWithVoid, flatMapToMap, missedPipeableOpportunity,
  missingEffectServiceDependency, missingPipeableSignature, multipleCatchTag, nestedEffectGenYield,
  newSchemaClass, preferSchemaTypeProperty, redundantMapError, redundantOrDie,
  redundantSchemaTagIdentifier, schemaNumber, schemaStructWithTag, schemaUnionOfLiterals,
  serviceNotAsClass, strictBooleanExpressions, syncToSucceed, unnecessaryArrowBlock,
  unnecessaryEffectGen, unnecessaryFailYieldableError, unnecessaryPipe, unnecessaryPipeChain,
  unnecessaryTypeofType.

Other features: 39 quick fixes (`internal/fixables/`); 21 refactors in `internal/refactors/refactors.go`
(wrapWithPipe, togglePipeStyle, pipeableToDatafirst, wrapWithEffectGen, removeUnnecessaryEffectGen,
asyncAwaitToGen, asyncAwaitToGenTryPromise, asyncAwaitToFn, asyncAwaitToFnTryPromise, effectGenToFn,
toggleTypeAnnotation, toggleReturnTypeAnnotation, toggleLazyConst, functionToArrow, layerMagic,
writeTagClassAccessors, typeToEffectSchema, typeToEffectSchemaClass, makeSchemaOpaque,
makeSchemaOpaqueWithNs, structuralTypeToSchema; README also lists debugPerformance as unsupported);
13 completions (`internal/completions/completions.go`); 3 codegens (`accessors`, `annotate`,
`typeToSchema`); hover enrichment with layer graphs and Mermaid links; inlay-hint suppression for
Effect generator return types; document symbols; auto-import style policy.

### 2.6 Generator, `Effect.gen`, `Effect.fn`, and `yield*` reasoning

- `typeparser/effect_gen.go`: `EffectGenCall` matches `Effect.gen(options?, function*(){...}, ...pipeArgs)`
  only when the callee resolves to `gen` exported by the Effect module.
- `typeparser/effect_fn.go`: `EffectFnCall` handles `fn`, `fnUntraced`, `fnUntracedEager`, the
  curried trace name `Effect.fn("name")(...)`, trailing pipe arguments, and their output types.
- `typeparser/effect_context.go`: one walk per file per checker tags nodes with `CanYieldEffect` and
  `InEffectConstructorThunk`, resets flags at function boundaries, and records the enclosing Effect
  generator (`GetEffectYieldGeneratorFunction`). The `*InEffect` rules use it.
- `typeparser/execution_flow.go`: builds a graph over pipe calls, `Effect.gen`, and `Effect.fn`.
- Rules on yields: `missingStarInYieldEffectGen` (bare `yield` of an Effect), `missingReturnYieldStar`
  (`yield*` of an Effect whose `A` is `never` without `return`), `returnEffectInGen`,
  `nestedEffectGenYield`, `unnecessaryEffectGen` (uses the shimmed unexported
  `checker.forEachYieldExpression`), `redundantMapError`, `redundantOrDie`.
- Refactors that synthesize generator code build TypeScript AST through `ls/change.Tracker` and its
  `NodeFactory`, for example `internal/refactors/async_await_to_gen.go` rewriting async/await into
  `Effect.gen(function*(){ ... yield* ... })`.

### 2.7 Build, test, ship

- Setup: `pnpm setup-repo` (`repoctl submodules setup`) checks out the profile's `gitHead` in
  `typescript-go/` with depth 1, applies `_patches/typescript-go/*.patch`, runs upstream
  `internal/diagnostics/generate.go` (which now merges Effect messages), and regenerates `shim/`.
- Build: `repoctl build` runs `go build -ldflags=-s -w -o _packages/tsgo-<target>/lib/<tsc|tsc-next> ./typescript-go/cmd/tsgo`
  with `CGO_ENABLED=0` for 7 targets (darwin-arm64, darwin-x64, linux-x64, linux-arm64, linux-arm,
  win32-x64, win32-arm64) and both profiles. It fails if the checkout differs from the profile's
  `gitHead` (`_tools/repoctl/src/build.ts`). `flake.nix` builds `.#effect-tsgo`.
- Test: `repoctl test` runs `go test ./...`, the shim generator tests, and vitest for the CLI. Go
  baselines live in `internal/effecttest/` (diagnostics, quick fixes, refactors, inlay hints, document
  symbols) over `testdata/tests/{effect-v3 (173), effect-v4 (276), effect-v3-refactors (42),
  effect-v4-refactors (43), ...}` with real packages, for example `effect@4.0.0-beta.101`
  (`testdata/tests/effect-v4/package.json`). `AGENTS.md` quotes 15-20 minutes for the suite.
- Ship: npm `@effect/tsgo` (bin `effect-tsgo`, latest 0.53.1, 2026-10-15) plus
  `@effect/tsgo-{darwin-arm64,darwin-x64,linux-arm,linux-arm64,linux-x64,win32-arm64,win32-x64}`.
- `effect-tsgo patch` (`_packages/tsgo/src/cli/index.ts`): resolves `typescript` (major >= 7), then
  `@typescript/native` (not on npm; an alias name), or `--typescript-package`; reads its `gitHead`;
  picks the packaged binary whose profile `gitHead` matches; renames
  `@typescript/typescript-<platform>-<arch>/lib/tsc` to `tsc.original`; copies the Effect binary in;
  runs `--version`. `--force` falls back to `tsc-next` or `tsc`; `effect-tsgo unpatch` restores.
- The Effect repo depends on it: https://github.com/Effect-TS/effect at
  `ad6901857e05e7b436a0149b5ece7f3a36d9ff33` has `"prepare": "node scripts/setup-agents.mjs && effect-tsgo patch"`,
  `typescript ^7.0.2`, and `@effect/tsgo ^0.51.1` in `package.json`.

### 2.8 Reuse for a language fork, and limits

| Category | Parts | Notes |
| --- | --- | --- |
| Reusable | `internal/typeparser` | Checker-backed Effect, Layer, Stream, Service, and Schema recognition for v3 and v4. |
| Reusable | `internal/rule`, `rulerunner`, `directives`, `pluginoptions`, patch 008 message merge, patch 009 exit filter | Diagnostic code range, severities, per-file overrides, suppression comments. |
| Reusable | LS patches 011, 012, 015, 017, 022, 024 | Generic after-X callbacks for hovers (A/E/R display), completions, refactors, symbols. |
| Reusable | `internal/effecttest`, `internal/bundledeffect`, `etstesthooks`, patch 010 helpers | Baseline harness with real Effect packages in a virtual FS. |
| Reusable | `@effect/tsgo` packaging and `patch` | Binary swap into a stock `typescript` install keyed by `gitHead`. |
| Lint-specific | 94 rules, 39 fixables, completions, codegens, oxlint and tsgolint integration, auto-import style | Policy about Effect usage, not language semantics. |

Limits:

- Post-check and additive. The callback runs after `links.typeChecked = true` and can only append
  diagnostics. No patch touches `transformers/`, `printer/`, or emit beyond the exit-code filter, so
  effect-tsgo cannot change parsing, binding, types, or output.
- One callback per hook. Two extensions in one binary need a multiplexer.
- Concurrency. Hooks run on whichever checker checks the file; state lives on `Checker.EffectLinks`.
- Exact pins. Each binary targets one upstream `gitHead`; drift fails the build or the `patch` command.
- Shim fragility. Effect-TS/tsgo PR [#832](https://github.com/Effect-TS/tsgo/pull/832) (2026-10-12)
  had to "generate provider-specific `TSGetSymbol*` helpers so Effect code supports field-based
  TypeScript 7.0.2 symbols and method-based current symbols".

### 2.9 baml-tsgo (`<external-checkout>/baml-tsgo`)

baml-tsgo (remote `git@github.com:smithersai/baml-tsgo.git`; HEAD `refs/heads/feat/baml-rust-tooling`
= `86a1bc31ce418a1ec8b06f9fc134be0c4f4667a6`; `main` = `431711f`; typescript-go `5b1047d`) is a copy of
effect-tsgo 0.27.1 that adds one hook, not a new embedding pattern. `_patches/typescript-go/028-module-resolver-hook.patch`
adds an unexported `registerBeforeResolveModuleNameCallback` in `internal/module/resolver.go` that runs
before the built-in resolver; `_tools/gen_shims/config/module/extra-shim.json` exposes it as
`module.RegisterBeforeResolveModuleNameCallback` through `//go:linkname`; `029-cmd-tsgo-baml-hook.patch`
blank-imports `bamlresolverhooks`. `bamlresolverhooks/init.go` maps relative `*.baml` imports to
Rust-generated `<name>.baml.d.ts` sidecars, and `bamlresolverhooks/e2e/run.sh` type-checks
`src/main.ts` against `story.baml.d.ts`. BAML source never enters the TypeScript AST, so editors get
no TypeScript features inside `.baml` files. Its `README.md` rejects a Volar-style projection in favor
of the native fork; the snapshot predates TypeScript's content mappers (merged 2026-08-19), which now
provide that projection natively. The pattern, "external compiler writes `.d.ts`, resolver hook maps
the import", is a valid interop path when another tool owns the language.

---

## Recommended fork baseline and seam

- Fork `microsoft/TypeScript`, not `microsoft/typescript-go`. Facts: typescript-go is archived and its
  README closes it (`89d5d5b`); its SHAs return HTTP 422 in `microsoft/TypeScript` (1.2).
- Pin `main` at the `gitHead` of a published `typescript@next` nightly (today 7.1.0-dev.20261015.1 ->
  `257e874`), require Go 1.27, and re-pin to the 7.1 stable tag when it ships (planned 2026-11-24).
  Facts: content mappers and the stable API exist only on `main` (1.3, 1.7); Effect pins `main`
  `9eedcb0` = 7.1.0-dev.20261014.1 (2.1); a matching `gitHead` enables the `effect-tsgo patch` binary
  swap and differential tests against the official binary (2.7).
- Prove the ABI through a content mapper before writing Go. A one-file mapper that lowers the design
  doc's `userName` example must make `tsc --runExternalCode -p .` emit
  `export declare const userName: (id: string) => Effect.Effect<string, NotFound, Users>` and report a
  TypeScript error at the EffectScript span; if either fails, skip this seam. Facts: mapped files get
  `.d.ts`, declaration maps, and rewritten imports (`contentMapperOutputExtensions.js`); the protocol
  stays backward compatible through 7.x (#64709).
- Fork Go only for lowering that needs resolved TypeScript types. Facts: a mapper receives only
  `FileName` and `Content` (`contentmapper.Request`); the TypeScript team rules out Go plugins and
  emit-side transforms (#63771).
- In the fork, put EffectScript code in-tree under `tsc/internal/effectscript/` and limit upstream
  edits to `Register*` hooks wired by blank imports in `tsc/cmd/tsc/main.go`. Implement EffectScript
  loading behind `CompilerHost.GetContentMappedSourceFiles` so `spanmap` supplies LSP remapping and
  declaration maps. Facts: the import-path rule and the demo (1.6); effect-tsgo covers checker, LS, and
  exit-code needs with 23 patches over 24 files (2.2, 2.3).
- Do not build the language on shim modules. Facts: 1,135 linknames and 24 unsafe struct mirrors in
  effect-tsgo (2.2); PR #832 broke on an upstream `Symbol` layout change (2.8); the linker checks
  linknames only for std "for now" (1.6).
- Reuse effect-tsgo's `internal/typeparser`, diagnostic infrastructure, and baseline harness (MIT),
  not its after-check hook, as the lowering seam. Facts: the hook only appends diagnostics after
  `links.typeChecked = true`, and no patch touches emit (2.3, 2.8).
- Next action: build the one-file content-mapper prototype against `typescript@7.1.0-dev.20261015.1`
  and record whether the `.d.ts`, hover, and diagnostic span checks pass.

## Open questions

1. Can EffectScript lowering be syntax-directed (for example, type-level dispatch helpers that let the
   TypeScript checker infer A/E/R), or does the design require resolved callee types at lowering time?
   This decides content mapper versus fork, and only the prototype answers it.
2. When does 7.1 ship? The plan's 2026-10-06 beta was not on npm on 2026-10-15.
3. Will `CompilerHost.GetContentMappedSourceFiles` and `contentmapper.Project` stay stable for
   in-process use? The 7.x compatibility promise covers the JSON-RPC protocol, not internal Go APIs.
4. How should EffectScript-only metadata (calling mode, foreign opacity) travel to other EffectScript
   packages? Plain `.d.ts` has no channel for it; whether mapper `Supplemental` files fit is unknown.
5. Does a fork built at the `typescript@next` `gitHead` behave identically to the published binary?
   Not checked; Microsoft's release build flags are known (1.5), its build environment is not.
6. Would Microsoft accept generic hook points (after-check, pre-resolution) upstream? No issue or PR
   for checker hooks was found; #63771 points the other way.
7. Will JavaScript emit for content-mapped files stay out of scope? `compiler/emitter.go` assigns it to
   the mapper or build tool; no issue tracks a change.
8. Which typescript-go ref produced `pushedAt` 2026-08-31, after the last `main` commit? Not
   identified.
