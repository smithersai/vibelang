# Typed file imports and comptime loaders

This document separates accepted requirements from syntax and API choices that
still need design work.

## Locked requirements

- VibeLang can import non-code files through comptime loaders.
- Every non-code or foreign-source import uses standard import attributes. The
  required string-valued `type` selects its loader; other string attributes
  configure that loader.
- JSON uses `with { type: "json" }`. Adding `mode: "const"` produces deeply
  readonly, literal-preserving types.
- Markdown with `{ type: "text" }` has a default `string` export containing the
  source. MDX uses `{ type: "mdx" }` and produces a typed component module.
- Direct `.rs` and `.zig` imports produce compiler-generated typed bindings and
  tracked foreign build artifacts. Authors do not maintain parallel declaration
  files for those imports.
- Existing Node-API packages, including packages built with napi-rs, remain
  ordinary npm dependencies on TypeScript runtimes. Consuming one does not
  require VibeLang-specific foreign-import syntax.
- Projects and packages can define loaders for any other file extension, such
  as YAML, SQL, GraphQL, images, or domain-specific formats.
- A loader produces a normal typed module. It may export comptime values,
  runtime values, and generated types; consumers use ordinary imports.
- Loading happens during compilation. It does not add `FileSystem` or another
  runtime platform requirement to the importing program.
- The incremental build graph records the source content, loader
  implementation, loader configuration, target/options, and every transitive
  input read by the loader. A change to any of them invalidates the result.
- Loaders use compiler-tracked asset imports rather than ambient filesystem,
  network, clock, or random access. This keeps comptime deterministic and watch
  mode sound.
- Loader diagnostics and generated declarations participate in normal
  type-checking, editor, and source-map behavior.
- MDX is a general asset format. Prompt components and code-writing agents are
  library features layered on top of MDX, not special compiler semantics.

## Current POC evidence (non-normative)

The root CLI/package integrates relative static asset imports with runtime
bindings across project commands. The wider programmatic API under
`vibelang/build` also discovers attributed asset re-exports, literal dynamic
imports, and nested loader-generated module graphs through four levels. It
issues one reconciled generated module per asset, tracks nested dependency
content in cache identity, and rejects undeclared generated-module edges.
Those wider forms are not yet wired through the root Vibe emitter/runtime
graph, so this is programmatic POC evidence rather than a root-CLI claim.

The same POC implements provisional answers for two otherwise open surfaces:

- a project file whose default export is `comptime.loader("type", fn)` can
  register one lowercase literal loader type. The call is recognized by
  TypeScript checker identity, the file is never executed in the compiler
  process, and the lowered loader always executes in the no-permission Deno
  sandbox. Built-ins take precedence (VCT1310 warning), duplicate project
  registrations fail closed (VCT1311), and VCT1300–VCT1313 cover rejected
  registration/identity/sandbox shapes;
- `{ type: "markdown" }` produces provisional literal-typed frontmatter, body,
  headings, and raw source exports, while `{ type: "mdx" }` produces a
  provisional pure-data render tree. MDX expression holes are identifier-only,
  never-evaluated placeholders.

Neither spelling/module shape is a locked production contract.

## TypeScript and TC39 compatibility

Existing TypeScript imports keep their TypeScript meaning. In particular,
VibeLang must not silently make an already-valid TypeScript JSON import readonly
or change its runtime behavior.

Const preservation is opt-in through import attributes:

```typescript
import config from "./config.json" with {
  type: "json",
  mode: "const",
};

// typeof config preserves values as literals:
// { readonly mode: "production"; readonly ports: readonly [80, 443] }
```

Raw source acquisition uses the same import-attribute surface as Import Text
and Import Bytes:

```typescript
import source from "./query.sql" with { type: "text" };
import image from "./logo.png" with { type: "bytes" };
```

`.ts` files continue through TypeScript's normal module rules. Loader extensions
apply to `.vibe` imports or when a TypeScript project explicitly enables the
VibeLang loader integration.

## Bun inspiration

VibeLang follows Bun's useful typed-file ergonomics without adopting every Bun
runtime mechanism. Bun can import `.txt` through its built-in text loader and
can apply that loader to another extension with an import attribute. VibeLang's
built-in `.md` string module applies the same direct-import idea to the common
prompt-authoring case.

Bun also has a dedicated `napi` loader for `.node` native addons, and its
Node-API documentation presents Node-API as the stable route for native code.
That is the model for consuming existing native npm packages on VibeLang's
TypeScript runtimes.

By contrast, Bun documents `bun:ffi` and its C-ABI binding generation as
experimental and not suitable for production reliance. VibeLang's direct Rust
and Zig imports are compiler-owned, tracked foreign builds with generated typed
modules; they are not specified as a thin wrapper over Bun's experimental C
FFI.

References: [Bun loaders](https://bun.com/docs/bundler/loaders),
[Bun Node-API](https://bun.com/docs/runtime/node-api), and
[Bun FFI](https://bun.com/reference/bun/ffi).

## Loader model

A loader is a compile-time function from a compiler-owned asset and tracked
loader context to a typed module description. This build-time object is not the
runtime `Context` imported from `vibelang/context`; using it records incremental
dependencies and does not add capabilities to a function's `R` row. The
programmatic POC recognizes this provisional declaration shape:

```typescript
import { comptime } from "vibelang:comptime";

export default comptime.loader("yaml", async (asset, context) => {
  const value = parseYaml(asset.text());

  // Reads through this API become dependency edges automatically.
  const schema = await context.import("./config.schema.json", {
    type: "json",
    mode: "const",
  });
  const checked = validate(schema.module.value, value);

  return {
    format: "yaml",
    value: checked,
    emittedTypeScript: emitLiteralModule(checked),
    declaration: emitDeclaration(checked),
    diagnostics: [],
    spans: [],
  };
});
```

`comptime.loader` is a compiler-recognized library API, not a special loader
declaration. In the POC, recognition is spelling-blind checker identity; only a
default export registering one literal lowercase type is accepted, and the
callback still returns the programmatic
value/TypeScript/declaration/diagnostic/span result. The final typed-module builder,
package registration, glob/extension selection, options, and production API
remain open.

The essential semantics do not depend on this spelling:

1. Module resolution selects a loader.
2. The compiler gives it immutable source text or bytes and a tracked context.
3. Reads through the context add graph edges recursively.
4. The result is checked as a module and cached.
5. Backends emit only the runtime exports actually used by the program; erased
   types and comptime-only values produce no runtime code.

A loader result must be representable in checked VibeLang IR or supply an
equivalent typed module plus span map. Returning untyped generated source is an
interop fallback, not the preferred interface.

## Incremental identity

Conceptually, a loader result is keyed by:

```text
hash(
  compiler version,
  loader identity and implementation graph,
  loader configuration,
  target and relevant compiler options,
  source bytes,
  transitive dependency hashes
)
```

The compiler stores the typed module, emitted artifacts, diagnostics, and span
map under that key. Loader dependencies are also watch dependencies. Merely
touching a file does not invalidate a result when its content hash is unchanged.

Loader identity must be stable across machines. Package resolution and its lock
file are therefore part of the loader implementation graph; a process-local
function identity is insufficient.

## Built-in formats

### JSON

The const mode is a built-in typed-file import. It parses JSON at comptime and
exports the exact value with recursively literal-preserving, deeply readonly
types. Objects have readonly properties; arrays preserve their elements as
readonly tuples. It needs no handwritten schema or declaration file.

```typescript
import config from "./config.json" with {
  type: "json",
  mode: "const",
};

// typeof config is:
// { readonly mode: "production"; readonly ports: readonly [80, 443] }
```

Invalid JSON is a compile diagnostic attached to the source file. The source
content is an incremental dependency, and the selected backend emits only the
runtime representation that is actually needed.

An ordinary JSON import that is already valid TypeScript retains TypeScript's
existing inferred type and runtime behavior. Const preservation is opt-in. The
optional schema-validation APIs remain open; the literal-preserving module
contract and import-attribute spelling do not.

### Markdown

Markdown is available without project configuration. A direct `.md` import
exports its source as a string by default:

```typescript
import systemPrompt from "./system.md" with { type: "text" };

const response = (await model.generate({ prompt: systemPrompt })).unwrap();
```

The import is resolved and tracked at compile time, so using the string does not
perform runtime filesystem I/O. The loader must preserve source locations for
diagnostics.

As a provisional programmatic POC contract, `{ type: "markdown" }` (also the
`.md` extension default) keeps the raw source as its default export and adds
literal-typed `frontmatter`, `body`, `headings`, and `source`. Headings cover
ATX headings outside fences and carry authored UTF-16 offsets. Frontmatter is a
strict bounded YAML subset supporting scalars, scalar lists, and one nested map
level; ambiguous YAML constructs fail with source locations. The final parsed
document/frontmatter contract remains open.

### MDX

MDX is available without project configuration and, by design, emits a typed
component module. The programmatic POC provisionally exports literal-typed
`frontmatter`, `source`, `body`, `components`, and `expressions`, with a render
tree as the default. Tree nodes are elements, text, or expression placeholders;
literal props are admitted, while `{name}` becomes a never-evaluated placeholder
and broader expressions fail closed. JSX-runtime selection, final component
injection, and the production default-export contract remain open. The agent
library may define components such as `System`, `Context`, and `Instructions`,
but the compiler treats them as library vocabulary rather than language
semantics.

The `.md` and `.mdx` defaults are intentionally different. Markdown is the
zero-ceremony string form for prompts and other text consumers. MDX is the
component form for structured rendering and library-defined component
vocabularies.

## Foreign source modules

Rust and Zig source files are first-class typed-file imports:

```typescript
import { hash } from "./hash.rs" with { type: "rust" };
import { tokenize } from "./tokenizer.zig" with { type: "zig" };
```

For each direct `.rs` or `.zig` import, the compiler must:

1. select a foreign-language adapter for the build target;
2. derive a checked VibeLang module interface from the exported foreign
   contract;
3. generate the necessary typed bindings and foreign artifact;
4. record the source, transitive foreign dependencies, toolchain, options, and
   target in the incremental graph; and
5. surface foreign diagnostics through the importing module with source
   locations where available.

The generated interface is the source of truth. Users must not need a parallel
`.d.ts` file merely to describe the imported symbols. Changes to an exported
foreign type or function invalidate and recheck VibeLang consumers.

The exact configuration for choosing native, Wasm, Node-API, or another
foreign target is open. ABI layout, ownership, allocation, async callbacks,
error translation, linking, Rust feature selection, Zig build options, and
cross-compilation policy also require separate design. Direct source imports
promise tracked typed bindings, not one fixed ABI for every target.

## Native npm packages on TypeScript runtimes

A package already distributed through npm with a Node-API addon remains a
normal dependency:

```typescript
import { transform } from "@scope/native-transform";
```

This includes napi-rs packages. On Node.js or Bun, the package's normal npm
entry point and `.node` loader select the platform binary. VibeLang does not
recompile the package's Rust source merely because napi-rs produced it, and it
does not require a direct `.rs` import.

This path is specific to a compatible TypeScript runtime and contributes the
same TypeScript/platform requirements as any other native npm dependency. It
does not by itself make the package portable to VibeLang's native or Wasm
backends. A package that wants those targets can additionally publish source or
artifacts through the future foreign-target configuration.

## Open design questions

1. Optional JSON schema-validation APIs.
2. Final loader declaration/registration and typed-module-builder APIs,
   including package distribution, glob/extension selectors, options, and
   whether the POC's built-in-first precedence becomes normative.
3. Finalization or replacement of the provisional Markdown frontmatter/body/
   headings exports and MDX render-tree/component-module contract.
4. Foreign target selection, ABI/binding rules, and toolchain configuration for
   direct Rust and Zig imports.
5. Whether a loader may emit auxiliary files, and how those outputs are named
   without losing reproducibility.
6. Cycle rules between code modules and loaded assets.
7. The final cross-platform isolation/attestation policy beyond the POC's
   default authenticated, no-permission Deno loader process.
8. The stable serialized representation for target-neutral typed loader output.
