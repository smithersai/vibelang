# Comptime asset imports and loaders

This document separates accepted requirements from syntax and API choices that
still need design work.

## Locked requirements

- VibeLang can import non-code files through comptime loaders.
- JSON has a concise **const import** form whose value has deeply readonly,
  literal-preserving types.
- Markdown and MDX loaders ship with the toolchain.
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

## TypeScript and TC39 compatibility

Existing TypeScript imports keep their TypeScript meaning. In particular,
VibeLang must not silently make an already-valid TypeScript JSON import readonly
or change its runtime behavior.

The const form therefore needs opt-in, superset-safe syntax. This is
illustrative, not yet accepted grammar:

```typescript
import config from "./config.json" as const;

// typeof config preserves values as literals:
// { readonly mode: "production"; readonly ports: readonly [80, 443] }
```

Raw source acquisition should converge on TC39 Import Text and Import Bytes
rather than inventing competing primitives. Asset loaders conceptually consume
those compiler-provided text or byte inputs, even while the proposals require a
temporary lowering:

```typescript
// Exact standards-track spelling remains subject to TC39.
import source from "./query.sql" with { type: "text" };
import image from "./logo.png" with { type: "bytes" };
```

`.ts` files continue through TypeScript's normal module rules. Loader extensions
apply to `.vibe` imports or when a TypeScript project explicitly enables the
VibeLang loader integration.

## Loader model

A loader is a comptime function from a compiler-owned asset and context to a
typed module description. A possible API shape is:

```typescript
// Proposed API only.
comptime loader "*.yaml" = (asset, context) => {
  const value = parseYaml(asset.text());

  // Reads through this API become dependency edges automatically.
  const schema = context.import("./config.schema.json", { const: true });
  const checked = validate(schema, value);

  return module {
    export default checked;
    export type Config = typeof checked;
  };
};
```

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

The const mode parses at comptime and preserves JSON literals recursively. It
reports syntax errors in the JSON file and emits only the value needed by the
selected backend. The exact relationship between const imports, ordinary
TypeScript JSON imports, and optional schema validation remains open.

### Markdown

Markdown is available without project configuration. The concrete export shape
is still open: likely raw source, parsed document/frontmatter, and a renderer or
renderable module. The loader must preserve source locations for diagnostics.

### MDX

MDX is available without project configuration and emits a typed component
module. JSX-runtime selection, frontmatter typing, component injection, and the
default export shape remain open. The agent library may define components such
as `System`, `Context`, and `Instructions`, but the compiler treats them like
ordinary typed components.

## Open design questions

1. Final const-JSON import grammar.
2. Loader declaration and registration syntax, including conflict precedence.
3. The standard export contracts for Markdown and MDX.
4. Whether a loader may emit auxiliary files, and how those outputs are named
   without losing reproducibility.
5. Cycle rules between code modules and loaded assets.
6. Sandboxing and resource limits for third-party loader execution.
7. The stable serialized representation for target-neutral typed loader output.

