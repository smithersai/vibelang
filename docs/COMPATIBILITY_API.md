# TypeScript compatibility API, POC subpaths, and CLI

Status: the root package integrates the checked `.vibe` POC, its runtime and
architecture APIs, and TypeScript compatibility surfaces. These entry points
are usable implementation evidence, not a stable or conforming production SDK.

## Package entry points

The package intentionally keeps TypeScript's compatibility API separate from
VibeLang additions:

| Import | Current contract |
| --- | --- |
| `vibelang` | Complete TypeScript 5.9 JavaScript compiler, factory, transform, watch, language-service, `ts.server`, and protocol API |
| `vibelang/tsserverlibrary` | Compatibility alias for the historical tsserver library entry point |
| `vibelang/plugin` | Pass-through TypeScript language-service `PluginModuleFactory` |
| `vibelang/vibe` | VibeLang-specific extension contracts and remaining placeholders |
| `vibelang/language` | No-write single-file and project `.vibe` analysis/lowering, declaration emit, source-map composition, and emitted-project validation |
| `vibelang/runtime` | Checked POC runtime used by generated `.vibe` modules |
| `vibelang/result` and `vibelang/optional` | Hardened Result/Optional values, compiler hooks, matching, and compatibility aliases |
| `vibelang/exceptions` | Checked panic constructors, catch adapters, and guards |
| `vibelang/context` and `vibelang/provider` | Async-scoped Context/Layer environment; provider also retains provisional Action/Flow compatibility types |
| `vibelang/build` | Programmatic hermetic assets, comptime evaluator, loader sandbox, and foreign-tool adapters |
| `vibelang/targets` | Conservative portability analysis and bounded canonical-IR/Wasm backend proof |
| `vibelang/concurrency` | Provisional typed workers, keyed joins, governors, unordered helpers, cancellation, Stream, Queue, Semaphore, and Channel |
| `vibelang/agent` | Programmatic coding-agent compiler, sandbox, Action/Flow bindings, prompt, SQLite journal, scripted model, and fakes |
| `vibelang/durable/authoring` | Provisional explicit Plan-authoring API |
| `vibelang/durable/artifact` | Static Plan artifact validation and loading |
| `vibelang/durable` | Node-safe static durable source compiler, Plan artifact facade, and canonical Ed25519 deployment-envelope verifier |
| `vibelang/durable/source-compiler` | Direct static `durable(...)` source-lowering API |
| `vibelang/durable/bun` | Bun SQLite executor/store, start/resume handles, HMAC-gated signals, wakeups, authenticated coordinator factory, and local/Deno-isolated worker protocols |
| `vibelang/unstable/*` | Direct wrappers for TypeScript 7's published unstable sync, async, filesystem, protocol, and AST APIs |

The package root is an identity re-export instead of a handwritten facsimile.
This preserves all public functions, enums, factories, nested namespaces,
compiler hosts, language-service methods, server protocol types, watch/build
APIs, and patch-level additions from the wrapped TypeScript 5.9 package.

```ts
import ts = require("vibelang")

const source = ts.createSourceFile(
  "example.ts",
  "export const value: number = 1",
  ts.ScriptTarget.Latest,
)
```

TypeScript 7 has not replaced that ecosystem JavaScript API. Its package root
currently exposes its version plus APIs under `typescript/unstable/*`;
VibeLang mirrors those subpaths separately so consumers can migrate
deliberately.

## Checked frontend API

The `vibelang/language` subpath performs no writes. The acceptance helper
checks both VibeLang diagnostics and generated TypeScript diagnostics:

```ts
import { compileAndCheckVibe } from "vibelang/language"

const checked = compileAndCheckVibe(sourceText, {
  fileName: "/absolute/input.vibe",
  outputFileName: "/absolute/input.generated.ts",
  sourceName: "input.vibe",
})

if (!checked.ok) {
  console.error(checked.result.analysis.diagnostics)
  console.error(checked.emitDiagnostics)
}
```

Lower-level exports include `analyzeSource`, `compileVibe`,
`checkEmittedTypeScript`, `analyzeProject`, `compileProject`,
`checkEmittedProject`, `emitProjectDeclarations`, and `composeSourceMaps`.
Project APIs consume an explicit in-memory source set and perform no writes.

## Language-service plugin

Configure the pass-through plugin with:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "vibelang/plugin" }]
  }
}
```

The plugin uses the `typescript` instance injected by tsserver and decorates
the supplied `LanguageService`, matching TypeScript's plugin ABI. It does not
add `.vibe` grammar. TypeScript language-service plugins affect editor
operations only; the future VibeLang LSP requires compiler integration.

## Commands

The root `vibe` CLI checks and emits the `.vibe` POC subset:

```sh
vibe check src/index.vibe
vibe compile src/index.vibe --outDir build
vibe compile src/index.vibe --outDir build --declaration --sourceMap
vibe run src/index.vibe
vibe test test/example.vibe --format json
vibe inspect src/index.vibe --format json
vibe plan flows/build.vibe --bindings actions.json --outFile build.plan.json
vibe doctor --format json
```

`.vibe` project commands discover relative `.vibe` dependencies plus the
reachable foreign runtime graph. The bounded foreign stager accepts relative
`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` static imports
and re-exports, literal dynamic imports from ESM-shaped foreign modules, and
literal `require(...)` edges from `.cts`/`.cjs`. It rewrites every resolved
relative edge and stages foreign output under deterministic
`__vibelang_foreign__/` paths without executing the graph during build.
Checker-resolved type-only dependencies participate in checking but produce no
runtime artifact.

Because ESM initialization runs before a generated call adapter can catch a
panic, each static `.vibe`-to-foreign runtime edge must resolve to a source with
file-leading JSDoc containing both `@module` and `@throws {never}`. This trust
requirement follows the static initialization closure, not a subtree reachable
only through a literal dynamic import inside a trusted async foreign adapter.

`compile` supports `--outDir`, `--rootDir`, `--noEmit`, `--declaration`, and
`--sourceMap`. It emits `.mjs`, optional `.d.mts`, staged ESM/CJS foreign
modules, and composed authored-source maps. Unchanged positions map exactly;
transformed tokens use conservative AST/text provenance, compiler-only text is
explicitly unmapped, and multi-source composition retains authored content
under deterministic bounds. The complete validated output set is staged before
commit. Unsupported or ambiguous graph edges, unsafe portability pins, root or
identity violations, budget violations, and colliding outputs fail before
commit. TypeScript/JavaScript-only `compile` and `check` invocations delegate to
the native TypeScript compiler. `build` and `init` are also TypeScript-backend
commands.

`test` runs exported zero-argument `test*` functions in a timeout/output-bounded
Node child and keeps `--format json` machine-readable. `plan` statically lowers
the bounded durable source subset without evaluating author modules. `format`
and `lsp` return structured `NOT_IMPLEMENTED` errors.

`vibec`, `vtsc`, and the compatibility `tsc` bin forward every raw argument,
in its original order, to the installed native TypeScript 7 compiler. The
`vtsserver` and compatibility `tsserver` bins run the JavaScript TypeScript 5.9
server:

```sh
vibec --project tsconfig.json --noEmit
vtsc --build --verbose
vtsserver
```

This separate path preserves exact `tsc` spellings, boolean-value forms,
repeated options, and exit codes that the structured `vibe` command parser may
otherwise interpret.

### Pinned Go compiler command

The repository-only `cmd/vibec-go` POC explicitly selects an exact Go fork
checkout with a clean `tsc` tree; it is not an npm compatibility bin and never
falls back to the JavaScript compiler:

```sh
go build -o /tmp/vibec-go ./cmd/vibec-go
/tmp/vibec-go \
  --fork-checkout /path/to/smithersai-TypeScript \
  --fork-cache /path/to/compiler-cache \
  --timeout 5m \
  src/main.vibe
```

Flags precede root names. Compile attempts emit exactly one `CompileResult`
JSON value on stdout. For the built binary, exit zero means emitted
successfully, one means a compiler/infrastructure/timeout failure or skipped
emit, two is the explicit
dependency-free scaffold when no checkout is selected, and 64 is a usage error
with no JSON. (`go run` masks nonzero child codes as one.) The deadline is
propagated through bridge preparation and compiler subprocesses, but cannot
preempt an uninterruptible local filesystem read or a noncooperative injected
backend. The cache must not overlap the checkout. Besides positional disk roots,
`--request request.json` submits one full `CompileRequest` value, which is how an
external frontend supplies pre-lowered TypeScript per `.vibe` file. This route
proves the identity TypeScript-shaped transform, multi-file `.vibe`/`.ts`
projects, and externally lowered input whose authored source maps the bridge
composes; it is not the root `vibe` frontend or a production compiler
distribution. Infrastructure and
deadline failures carry `VIBE_GO_BACKEND`/`VIBE_GO_TIMEOUT` in JSON and repeat
detail on stderr. SIGINT/SIGTERM still use abrupt default process behavior and
do not promise a final JSON envelope.

## Known gaps

- Concrete Error and Context rows propagate across the explicitly supplied
  `.vibe` project graph. Generic row polymorphism, incremental checking, watch
  mode, editor integration, a stable Context-row declaration encoding, and the
  candidate `.vibex` extension remain unimplemented.
- Foreign provenance is checker-backed and deliberately conservative, but the
  complete JavaScript heap/data-flow problem is not claimed. Unsupported or
  unprovable boundary shapes fail closed. Static foreign module initialization
  occurs before a generated call-level panic adapter can run, so a runtime
  TS/JS import requires file-leading JSDoc containing both `@module` and
  `@throws {never}`. Type-only imports and compiler intrinsics are exempt. A
  trusted async foreign adapter may defer dynamic loading so rejection enters
  its ordinary checked panic boundary. The module marker is a provisional
  trust claim rather than runtime proof or a final declaration/tooling format.
- The mixed-project path is a staging prototype, not a bundler or complete Node
  package-mode implementation. It deliberately treats `.js`, `.jsx`, `.ts`,
  and `.tsx` as ESM; leaves bare/package/platform imports external; rejects
  nonliteral loads and unsupported ESM/CJS crossings; and uses provisional
  no-check declaration facades for JSX/CJS where inference is incomplete.
  Columns after rewritten foreign specifiers are conservative rather than
  claimed exact.
- Common ambient host bindings are rejected. Checker-resolved wall/monotonic
  clock and entropy operations on `Date`, `performance`, `Math`, and `crypto`
  also add `Clock`/`Random` requirements in both language and target analysis,
  while lexical shadows remain ordinary values. This is a bounded classifier,
  not a claim that every Web/Node host API has been enumerated.
- Layer inference recognizes a bounded set of concrete built-ins. Opaque or
  generic layers and cross-module provider graphs are outside the current
  checker. Base Layers intentionally have only a `Layer<Provides>` row and do
  not model acquisition or resource ownership.
- Control-effect lowering is statement-safe and deliberately conservative.
  Lexical-tail `defer`/`errdefer` is executable for a bounded direct-statement
  syntax, Result-error exit, provisional LIFO ordering, and one narrow async
  cleanup shape. Braced `if`/`switch` expressions now lower in proven general
  expression positions; labeled block values, labeled `for`/`while` values with
  `else`, and closed-literal-union switch exhaustiveness are also implemented.
  Order-unpreservable hosts, unstable callees, braceless general-placement
  branches, unsafe label/loop shapes, generators, repeated effectful loop
  headers, and unlabeled loop expressions still fail closed.
- The compiler-owned `vibelang:comptime` and `vibelang:flows` virtual modules
  are not npm runtime entry points. Checker-identity-based comptime and durable
  source lowerers exist, and root `check`, `compile`, `run`, and `test` compose
  comptime before Vibe lowering. The bounded interpreter now includes local
  mutation, `while`/`do-while`/`for`/`for-of`, unlabeled break/continue,
  interpreter-owned container mutation, a deterministic stdlib allowlist, and
  hard VCT1012 budgets. A top-level comptime const used as a type emits a
  value-derived literal alias (and erases the const when it is non-exported and
  type-only); VCT1013 rejects unsupported type production. It is still not
  general JavaScript or arbitrary computed/mapped/generic type evaluation.
  Static attributed source assets lower through compiler-issued pure-data
  modules in every root project command. The programmatic `vibelang/build`
  source-asset seam additionally handles attributed re-exports, literal dynamic
  imports, and nested generated-module graphs to depth four, but those widened
  graph forms are not yet end-to-end root CLI runtime lowering. One unified
  incremental graph and general durable control flow remain future work.
- `vibelang/provider` has a working Context/Layer environment, but its
  async lifetime boundary currently requires Node's synchronous V8 Promise
  settlement hooks and a Promise created during the provider body. Existing
  Promises use `async () => await promise`; unsupported hosts fail closed.
  Action/Flow exports remain compatibility scaffolding. Use the durable
  subpaths only as explicit POC APIs.
- Durable Action input/success/Error codecs and static Flow input/projected-
  success/reachable-error codecs are now checker-derived for a bounded
  structural type set and validated at coordinator/worker/replay/cache
  boundaries. They are not yet the shared compiler descriptor used by ordinary
  validators, declarations, loaders, RPC, and provider contracts; the exact
  Error/wire encoding remains provisional. A separate bounded implementation
  contract derives `E`/`R` from a closed `.vibe` source project and requires
  exact provider grants plus equality between recoverable `E` and the Action's
  nominal failure schema, but does not prove declared-error reachability or
  attest lexical closures/remote bundles. Legacy callback-authored
  Plan artifacts retain weaker generic JSON schemas for compatibility.
- Native and general Wasm code generation are not implemented. The target
  subpath provides conservative classification plus a bounded checker-authored
  single-module portable IR with a TypeScript-host evaluator and real
  import-free `wat2wasm` output. Plain, Optional, Result, boolean, and finite
  `f64` exits have cross-runtime wire/hash tests, as do intra-module calls
  (recursion rejected, depth capped), locals and assignment, `if`/`while`/`for`
  under a fixed loop-fuel budget whose exhaustion is a canonical defect in both
  runtimes, scalar error payloads, and interned printable-ASCII string literals
  with pooled equality and length. Imports, Context, objects, closures,
  generics, async, GC, host ABI design, whole-project partitioning, string
  parameters, string concatenation, and non-ASCII strings remain outside that
  proof; the external tool is bounded and hashed but still trusted.
- The TypeScript language-service plugin is pass-through, and `vibe lsp` is an
  explicit placeholder.
- TypeScript 7 marks its new API subpaths unstable; wrappers may change with
  upstream. `typescript-fork.json` pins the exact fork revision. The
  `NewPinnedFork` integration proof exercises the upstream Go content mapper,
  Program/checker, mapped declaration emit, runtime emit, multi-file projects
  with `.vibe` import rewriting, and composed authored source maps for both
  identity and externally lowered input; the explicitly selected
  `cmd/vibec-go --fork-checkout` route exercises disk-root checking/runtime
  emit/maps and the `--request` external-lowering path. The reviewed vendored
  subtree, fork-owned Vibe lowering (the frontend still supplies it), a package
  host with `tsconfig`/module resolution, and a signed distributed compiler
  binary are still absent.
