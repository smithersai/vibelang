# Package and toolchain compatibility contract

Status: **Direction**, except where the language specification locks semantics.

This document defines the target public packaging and programmatic toolchain
surface. It does not describe repository entry points or implementation
coverage. Exact package names remain directional until explicitly locked.

## Packaging principles

1. Smithers language semantics MUST have one public contract regardless of the
   CLI, editor, bundler, or programmatic host that invokes them.
2. TypeScript compatibility APIs MUST remain distinguishable from
   Smithers-specific APIs.
3. Compiler-owned virtual modules MUST NOT have an ordinary runtime fallback.
4. Host-specific APIs MUST live behind capabilities or explicit host entry
   points; importing a platform-neutral module MUST NOT pull in Bun-, Node-, or
   browser-only dependencies.
5. A stable entry point MUST NOT expose experimental transitive types without a
   stability marker.

## Target entry points

| Import | Target contract | Maturity |
| --- | --- | --- |
| `smthrs` | Compiler distribution metadata and TypeScript-compatible compiler API | Direction |
| `smthrs/result` | `Result<A, E>`, matching, transformation, recovery, and trusted boundary adapters | Direction |
| `smthrs/exceptions` | `Panic`, defect/cause inspection, and foreign-boundary guards | Direction |
| `smthrs/context` | Nominal `Context` capability declaration and lookup | Direction |
| `smthrs/provider` | Layer construction, composition, and scoped provision | Direction |
| `smthrs/schema-runtime` | Runtime Schema and Codec values derived from compiler type descriptors | Direction |
| `smthrs/platform` | Platform-neutral capability contracts and pure host-independent values | Direction |
| `smthrs/data` | Persistent data, equality, hashing, and exhaustive value matching | Direction |
| `smthrs/concurrency` | Cancellation, joins, governors, streams, queues, semaphores, channels, and worker contracts | Direction |
| `smthrs/durable` | Plan artifacts, deployment contracts, execution handles, and runtime interfaces | Direction |
| `smthrs/build` | Programmatic project, loader, comptime, build, and artifact APIs | Direction |
| `smthrs/agent` | Coding-agent composition, model adapters, typed function bindings, and durable adapters | Direction |

`Maturity: Direction` says the **name** is not locked. It does not say the entry
point is unbuilt, and readers have taken it that way in both directions. Which
specifiers resolve is a separate, measured fact, re-derivable in one command:

```sh
node -e 'for (const s of ["smthrs","smthrs/result","smthrs/exceptions","smthrs/context","smthrs/provider","smthrs/schema-runtime","smthrs/platform","smthrs/data","smthrs/concurrency","smthrs/durable","smthrs/build","smthrs/agent"]) import(s).then(()=>console.log("ships  ",s),e=>console.log("absent ",s,e.code))'
```

Every row above resolves today. `smthrs/schema` does **not** exist and is not
planned as a second name for the same module: the runtime half of schema
derivation is the lowering target of the compiler-owned `smithers:schema`, so it
ships under the name the emitter imports, `smthrs/schema-runtime`. Giving it a
second, author-shaped alias is exactly the "ordinary runtime fallback" principle
3 forbids. The agent library ships as `smthrs/agent`, not `@smithers/agent`;
that scope is not a published package.

Host implementations may use explicit subpaths. The only one that exists today is
`smthrs/durable/bun` (plus `smthrs/agent/bun` and `smthrs/concurrency/bun`); a
platform-neutral parent may not depend on a host. There is no
`smthrs/platform/node` subpath — Node bindings (`NodePlatform`, `NodeFileSystem`,
`NodeProcess`, `NodeSocket`, `nodePlatform`) are exported from `smthrs/platform`
itself, which means that entry point does not yet satisfy principle 4 and is the
open item here.

The package MUST NOT expose `Optional<T>` or portability-target APIs. Absence is
`T | undefined`, and TypeScript is the sole compilation target.

## Compiler-owned modules

These specifiers are resolved only by the Smithers compiler:

| Import | Meaning |
| --- | --- |
| `smithers:comptime` | required compile-time evaluation, target selection, embedding, and loader declarations |
| `smithers:flows` | `durable(...)` and compiler-recognized Flow authoring helpers |
| `smithers:schema` | compiler type reflection and schema derivation |

Resolution uses declaration identity, not an identifier's text. Aliases retain
intrinsic behavior; a user function with the same name remains ordinary. A
compiler-owned import that survives into runtime output is a compiler error.

## Programmatic compiler API

The programmatic API operates on an explicit project host rather than ambient
filesystem state:

```ts
interface SmithersProjectHost {
  readSource(path: ProjectPath): Promise<SourceFile | undefined>
  resolve(specifier: string, from: ProjectPath): Promise<Resolution>
  loadAsset(request: AssetRequest): Promise<CompilerAsset>
  writeArtifact?(artifact: BuildArtifact): Promise<void>
}

interface SmithersProgram {
  check(): Promise<CheckResult>
  emit(options: EmitOptions): Promise<EmitResult>
  inspect(query: InspectQuery): Promise<InspectResult>
}

declare function createSmithersProgram(
  config: ProjectConfig,
  host: SmithersProjectHost,
): Promise<SmithersProgram>
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

Smithers MUST preserve the public TypeScript behavior it claims to support:

- ordinary `.ts`, `.tsx`, and JavaScript-family modules retain TypeScript and
  JavaScript semantics;
- shared compiler API objects use the same identity and enum values as the
  bundled TypeScript version;
- native TypeScript command compatibility is available through `smithersc`;
- `.d.ts` artifacts remain consumable by ordinary TypeScript projects; and
- Smithers-only failure and requirement metadata is ignorable by TypeScript but
  lossless for downstream Smithers tools.

The distribution MUST publish the exact compatible TypeScript version. It MUST
NOT combine API values from multiple TypeScript copies in one compiler or
language-service process.

## Bundlers

The target bundler integration is an unplugin factory shared by Vite, Rollup,
webpack, esbuild, Rspack, Rolldown, Farm, and Bun integrations. It resolves
`.sm`, invokes the same compiler semantics, emits ordinary TypeScript or
JavaScript plus source maps, and exposes accurate watch invalidation.

Checked mode is the default. Transform-only mode is an explicit performance
choice and MUST fail closed when lowering needs unavailable whole-program
information. It is not a substitute for `smithers check`.

## Editor integration

The language server and any TypeScript language-service plugin use the same
project graph, checker, diagnostics, generated-module identities, and source-map
provenance as the CLI. Their target surface includes diagnostics, completion,
hover for failure and requirement rows, definitions, references, rename,
signature help, formatting, code actions, and semantic navigation.

Editor recovery may produce partial answers while a document is incomplete. It
MUST NOT change language acceptance or silently suppress a build diagnostic.

## CLI

The target CLI contract is specified in
[the CLI reference](https://docs.smithers.sh/reference/cli). In particular,
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
   the Smithers language server.
