# Package and toolchain compatibility contract

Status: **Direction**, except where the language specification locks semantics.

Compiler implementation direction, reaffirmed by the owner on 2026-09-06/07:
use the current pinned native Go TypeScript compiler, not the TypeScript 5.9
compiler library. The former 5.9 object-identity facade is superseded by the
explicit native request API described below. TypeScript source/output
compatibility is unchanged.

This document defines the target public packaging and programmatic toolchain
surface. It does not describe repository entry points or implementation
coverage. Exact package names remain directional until explicitly locked.

## Packaging principles

1. VibeLang language semantics MUST have one public contract regardless of the
   CLI, editor, bundler, or programmatic host that invokes them.
2. TypeScript compatibility APIs MUST remain distinguishable from
   VibeLang-specific APIs.
3. Compiler-owned virtual modules MUST NOT have an ordinary runtime fallback.
4. Host-specific APIs MUST live behind capabilities or explicit host entry
   points; importing a platform-neutral module MUST NOT pull in Bun-, Node-, or
   browser-only dependencies.
5. A stable entry point MUST NOT expose experimental transitive types without a
   stability marker.

## Target entry points

| Import | Target contract | Maturity |
| --- | --- | --- |
| `vibelang`, `vibelang/compiler` | Native compiler identity and versioned data-only request API | Direction |
| `vibelang/result` | `Result<A, E>`, matching, transformation, recovery, and trusted boundary adapters | Direction |
| `vibelang/exceptions` | `Panic`, defect/cause inspection, and foreign-boundary guards | Direction |
| `vibelang/context` | Nominal `Context` capability declaration and lookup | Direction |
| `vibelang/provider` | Layer construction, composition, and scoped provision | Direction |
| `vibelang/schema-runtime` | Runtime Schema and Codec values derived from compiler type descriptors | Direction |
| `vibelang/platform` | Platform-neutral capability contracts and pure host-independent values | Direction |
| `vibelang/data` | Persistent data, equality, hashing, and exhaustive value matching | Direction |
| `vibelang/concurrency` | Cancellation, joins, governors, streams, queues, semaphores, channels, and worker contracts | Direction |
| `vibelang/durable` | Plan artifacts, deployment contracts, execution handles, and runtime interfaces | Direction |
| `vibelang/build` | Programmatic project, loader, comptime, build, and artifact APIs | Direction |
| `vibelang/agent` | Coding-agent composition, model adapters, typed function bindings, and durable adapters | Direction |

`Maturity: Direction` says the **name** is not locked. It does not say the entry
point is unbuilt, and readers have taken it that way in both directions. Which
specifiers resolve is a separate, measured fact, re-derivable in one command:

```sh
node -e 'for (const s of ["vibelang","vibelang/result","vibelang/exceptions","vibelang/context","vibelang/provider","vibelang/schema-runtime","vibelang/platform","vibelang/data","vibelang/concurrency","vibelang/durable","vibelang/build","vibelang/agent"]) import(s).then(()=>console.log("ships  ",s),e=>console.log("absent ",s,e.code))'
```

Every row above resolves today. `vibelang/schema` additionally exports the
general runtime Schema/Codec library; it is not an ordinary fallback for
compiler-owned `vibelang:schema`. Compiler-derived validators use
`vibelang/schema-runtime`. The agent library ships as `vibelang/agent`, not
`@vibelang/agent`; that scope is not a published package.

Host implementations may use explicit subpaths. The only one that exists today is
`vibelang/durable/bun` (plus `vibelang/agent/bun` and `vibelang/concurrency/bun`); a
platform-neutral parent may not depend on a host. There is no
`vibelang/platform/node` subpath — Node bindings (`NodePlatform`, `NodeFileSystem`,
`NodeProcess`, `NodeSocket`, `nodePlatform`) are exported from `vibelang/platform`
itself, which means that entry point does not yet satisfy principle 4 and is the
open item here.

The package MUST NOT expose `Optional<T>` or portability-target APIs. Absence is
`T | undefined`, and TypeScript is the sole compilation target.

## Compiler-owned modules

These specifiers are resolved only by the VibeLang compiler:

| Import | Meaning |
| --- | --- |
| `vibelang:comptime` | required compile-time evaluation, target selection, embedding, and loader declarations |
| `vibelang:flows` | `durable(...)` and compiler-recognized Flow authoring helpers |
| `vibelang:schema` | compiler type reflection and schema derivation |

Resolution uses declaration identity, not an identifier's text. Aliases retain
intrinsic behavior; a user function with the same name remains ordinary. A
compiler-owned import that survives into runtime output is a compiler error.

## Programmatic compiler API

The currently shipped `NativeCompiler` is shared by `vibelang` and
`vibelang/compiler`. It accepts explicit source files and returns serializable
diagnostics, analysis facts and base64-encoded artifacts. `identity` publishes
the native compiler version, pinned source revision, patch and executable
digests, and transport API version. Installed consumers need the matching
packaged executable, not a checkout or Go toolchain. CommonJS hosts use dynamic
`import()` on supported Node 22 versions.

The old `createProgram`, `createLanguageService`, `transpileModule`, and
`typescript` object facade are removed. So are the TypeScript/tsserverlibrary
subpath aliases and pass-through `plugin`/`language-service` shims. They do not
silently alias another implementation. Native `compile`, `transpile`,
`analyzeLanguage`, `inspect`, `format`, and `tokenAt` requests replace the
compiler-library operations; no mutable Program, checker or AST crosses the
boundary. `vibe lsp` remains the editor entry point. The 5.9 `tsserver` and
`vtsserver` launchers are retired, not relabeled as an incompatible protocol.

The high-level language, durable and editor helpers also use native requests.
The stock `unstable/*` client/AST pass-throughs are retired: they exposed an
unpinned compiler or JavaScript-side scanner rather than this native contract.
`vibec` uses the same pinned executable for ordinary TypeScript command-line
compilation. The npm TypeScript package is a development-only build tool, not a
product dependency or a fallback. Full migration verification is recorded in
`compiler/GO-MIGRATION.md`; API availability is not an alpha-0 release certificate.

The longer-term programmatic host contract operates on explicit inputs rather
than ambient filesystem state:

```ts
interface VibeLangProjectHost {
  readSource(path: ProjectPath): Promise<SourceFile | undefined>
  resolve(specifier: string, from: ProjectPath): Promise<Resolution>
  loadAsset(request: AssetRequest): Promise<CompilerAsset>
  writeArtifact?(artifact: BuildArtifact): Promise<void>
}

interface VibeLangProgram {
  check(): Promise<CheckResult>
  emit(options: EmitOptions): Promise<EmitResult>
  inspect(query: InspectQuery): Promise<InspectResult>
}

declare function createVibeLangProgram(
  config: ProjectConfig,
  host: VibeLangProjectHost,
): Promise<VibeLangProgram>
```

The exact names are directional. The contract is not:

- source, asset, package, and configuration reads cross the host interface;
- every tracked input contributes to invalidation and cache identity;
- diagnostics point to authored source and retain structured cause paths;
- `check` and `inspect` perform no writes;
- `emit` returns a complete staged artifact set before the host commits it; and
- no API executes authored modules merely to discover types, assets, comptime
  results, or Flow plans.

## TypeScript compatibility

VibeLang MUST preserve the public TypeScript behavior it claims to support:

- ordinary `.ts`, `.tsx`, and JavaScript-family modules retain TypeScript and
  JavaScript semantics;
- compiler integration uses the native request protocol, not shared 5.9 API
  objects or enum values;
- native TypeScript command compatibility is available through `vibec`;
- `.d.ts` artifacts remain consumable by ordinary TypeScript projects; and
- VibeLang-only failure and requirement metadata is ignorable by TypeScript but
  lossless for downstream VibeLang tools.

The distribution MUST publish the exact compatible TypeScript version. It MUST
NOT combine API values from multiple TypeScript copies in one compiler or
language-service process.

## Bundlers

The target bundler integration is an unplugin factory shared by Vite, Rollup,
webpack, esbuild, Rspack, Rolldown, Farm, and Bun integrations. It resolves
`.vibe`, invokes the same compiler semantics, emits ordinary TypeScript or
JavaScript plus source maps, and exposes accurate watch invalidation.

Checked mode is the default. Transform-only mode is an explicit performance
choice and MUST fail closed when lowering needs unavailable whole-program
information. It is not a substitute for `vibe check`.

## Editor integration

The language server uses the same
project graph, checker, diagnostics, generated-module identities, and source-map
provenance as the CLI. Their target surface includes diagnostics, completion,
hover for failure and requirement rows, definitions, references, rename,
signature help, formatting, code actions, and semantic navigation.

Editor recovery may produce partial answers while a document is incomplete. It
MUST NOT change language acceptance or silently suppress a build diagnostic.

## CLI

The target CLI contract is specified in
[the CLI reference](https://vibelang.sh/reference/cli). In particular,
users do not select an implementation backend, project writes are atomic, and
structured output is versioned.

## Stability and versioning

Every machine-readable envelope, declaration metadata record, Plan artifact,
loader protocol, and worker protocol carries an explicit schema or ABI version.
Readers reject unknown incompatible versions instead of guessing.

Stable entry points follow semantic versioning. Directional entry points use an
`unstable` namespace or an explicit experimental package until their contract is
locked. A move from unstable to stable includes a migration description; it is
not silently aliased forever.

## Open decisions

1. Final package names and whether the compiler API and standard library share
   one npm package.
2. The TypeScript API compatibility window and update cadence.
3. Project configuration filename, schema, workspace model, and host API.
4. Declaration encoding for generic failure and requirement rows.
5. Exact Node, Bun, Deno, browser, and edge entry-point organization.
6. Stability rules for generated schema, loader, Plan, and worker protocols.
7. Whether a TypeScript language-service plugin complements or merely launches
   the VibeLang language server.
