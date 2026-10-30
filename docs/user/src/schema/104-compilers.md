# Schema Compilers

Effect's experimental Schema compilers work behind the ordinary Schema APIs. They generate JavaScript for supported parsing operations and leave unsupported work to the interpreter. Measure the change on your schemas before relying on a speedup. Plain builders follow the [call rules](085-introduction.md#configuring-compiler-prerequisites).

## Understanding optimized validation paths

```vibe
// schemas/Parcel.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try readParcel({ reference: "pkg-94", count: 2 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(readParcel({ reference: "pkg-94", count: "2" }), (error) => Console.log(error._tag)) })
export const Parcel = Schema.Struct({
  reference: Schema.String,
  count: Schema.Int
})

effect function readParcel(input: unknown) {
  return try Schema.decodeUnknownEffect(Parcel)(input)
}
```

```output
{"reference":"pkg-94","count":2}
SchemaError
```

A compiler installs optimized operations for exact schema ASTs. A decoder or constructor can try a synchronous fast path: success returns immediately, and failure falls through to the detailed parser that produces normal issues. Guards can return false directly, since they need no detailed failures.

Compilation must be active for the AST and operation before a consumer captures its parser. After a failed fast path, checks and property getters can run twice, so keep them deterministic and free of side effects. The compiler skips fast paths that would unsafely replay defaults, class construction, transformations, middleware, or other effectful work.

## Enabling just-in-time compilation and fallback

```vibe
// main.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try receiveCompiled({ reference: "pkg-94", count: 2 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(receiveCompiled({}), (error) => Console.log(error.message)) })
import "effect/schema/SchemaJITCompiler/enable"

const CompiledParcel = Schema.Struct({
  reference: Schema.String,
  count: Schema.Int
})

effect function receiveCompiled(input: unknown) {
  return try Schema.decodeUnknownEffect(CompiledParcel)(input)
}
```

```output
{"reference":"pkg-94","count":2}
Missing key
  at ["reference"]
```

Put the enabling import before code that creates or runs parsers; importing the compiler namespace alone does not enable it. Operations compile lazily on first use, without eagerly running every check or default.

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { enableSelectedDirections(); try Console.log(try Schema.decodeEffect(Schema.FiniteFromString)("2")); try Console.log(Schema.is(Schema.toType(Schema.FiniteFromString))(2)); try Console.log(try Schema.encodeEffect(Schema.FiniteFromString)(2)) })
function enableSelectedDirections() {
  SchemaJITCompiler.enable(Schema.FiniteFromString.ast)
  SchemaJITCompiler.enable(SchemaAST.toType(Schema.FiniteFromString.ast))
  SchemaJITCompiler.enable(SchemaAST.flip(Schema.FiniteFromString.ast))
}
```

```output
2
true
2
```

Selective enabling covers the exact AST and the dependencies parsing reaches. The original AST decodes, the type projection validates and constructs decoded values, and the flipped AST encodes. Global enabling handles those roots as operations encounter them.

JIT constructs functions dynamically. When the engine or Content Security Policy blocks that, or generation or initialization fails, parsing stays interpreted. An exception from a compiled parser already running is an ordinary parser exception, not a compiler-initialization failure that triggers a retry.

## Generating and loading ahead-of-time validators

```ts
// TypeScript (.ts)
// build-schema-aot.ts
// types: node
// run: return Effect.flatMap(buildSchemas(), (result) => Console.log(`Prepared ${result.schemas} schema exports`))
import { fileURLToPath } from "node:url"
import { Console, Effect } from "effect"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as Build from "effect/schema/SchemaAOTCompiler/Build"

export const buildSchemas = () => Effect.provide(
  Build.build({
    modules: {
      "./schemas/Parcel.js": () => import("./schemas/Parcel.js")
    },
    baseUrl: import.meta.url,
    outFile: fileURLToPath(new URL("./generated/parcel-validators.js", import.meta.url)),
    operations: ["decode", "encode", "is", "make"]
  }),
  [NodeFileSystem.layer, NodePath.layer]
)
```

```output
Prepared 1 schema exports
```

```vibe
// build.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-26
// run: void 0
import { buildSchemas } from "./build-schema-aot.ts"

export effect function main() {
  const build = try sync(() => buildSchemas())
  const result = try build
  try Console.log(`Prepared ${result.schemas} schema exports`)
}

await runPromise(main())
```

```output
Prepared 1 schema exports
```

The build Effect finds directly exported schema values in the listed modules and writes a self-installing ES module. Module keys resolve relative to `baseUrl`; each loader must load the module its key names. The TypeScript helper keeps the Promise-returning dynamic module loaders at the foreign-code boundary. Build requires FileSystem and Path; the helper provides the Node layers. The output URL is relative to the emitted helper, so a helper in `dist/` writes `dist/generated/parcel-validators.js` whatever the working directory; a relative `outFile` string resolves from the process working directory instead.

With these sources under `src/` and JavaScript output in `dist/`, compile the build entry separately so the application does not need the generated module yet:

```json
{
  "extends": "./tsconfig.json",
  "files": ["src/build.vibe"],
  "include": []
}
```

Save this as `tsconfig.aot.json`, then run `vibelang -p tsconfig.aot.json` and `node dist/build.js`. The compiler follows the build entry's imports to the helper and schema module. The entry calls `runPromise(main())` explicitly, so running `dist/build.js` executes the build Effect. For the application compilation, set `compilerOptions.rootDirs` to `["src", "dist"]` so its generated-module import resolves in `dist/`, then compile and run the application.

Decoding is the default operation; add encoding, guards, and construction only when needed. Nested dependencies need no direct export unless an otherwise undiscovered graph requires a separate target.

```vibe
// fragment
// application.vibe
// pending: VIP-1, VIP-5, VIP-14
import "./generated/parcel-validators.js"
import { Parcel } from "./schemas/Parcel.vibe"

effect function receive(input: unknown) {
  return try Schema.decodeUnknownEffect(Parcel)(input)
}
```

Load the generated module before using the schemas, and ensure the bundler preserves its installation side effect. AOT code uses static functions; it neither imports the source generator nor constructs functions dynamically. Regenerate it whenever schema definitions or the Effect version change, because it reads callbacks and symbols from matching runtime ASTs.

## Using lower-level compiler APIs

```vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { try Console.log(generateSource().includes("export function install")) })
import * as SchemaAOTCompiler from "effect/schema/SchemaAOTCompiler"

function generateSource() {
  return SchemaAOTCompiler.compile([
    { ast: Parcel.ast, operations: ["decode"] },
    { ast: SchemaAST.toType(Parcel.ast), operations: ["is", "make"] },
    { ast: SchemaAST.flip(Parcel.ast), operations: ["decode"] }
  ])
}
```

```output
true
```

The low-level compiler returns source text and leaves file writing and installation to you: save it as a module and call its exported `install` with the same ASTs in exactly the same order. The application build API does the projections and installation wiring automatically.

| Goal | Target AST | Low-level operation |
| --- | --- | --- |
| Decode | original `.ast` | `decode` |
| Encode | `SchemaAST.flip(ast)` | `decode` |
| Validate decoded value | `SchemaAST.toType(ast)` | `is` |
| Construct decoded value | `SchemaAST.toType(ast)` | `make` |

The low-level API calls directional parsing `decode`, the flipped encoding path included. The ordered AST array is part of the install contract; reordering it can connect a parser to the wrong schema. `SchemaCompiler.set` is the lower-level registry entry point for a custom compiled implementation.

## Specialized operations, registries, startup behavior, and limits

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: await runPromise(effect { { const jsonValue = try parseNormally({ reference: "pkg-94", count: 2 }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Effect.catch(parseNormally({ reference: "pkg-94", count: 2, extra: true }), (error) => Console.log(error.message)) })
effect function parseNormally(input: unknown) {
  return try Schema.decodeUnknownEffect(Parcel)(input, {
    errors: "all", onExcessProperty: "error"
  })
}
```

```output
{"reference":"pkg-94","count":2}
Expected no excess property
  at ["extra"]
```

Supported primitives, objects, arrays, tuples, unions, and template literals can use generated validation. Struct and homogeneous-array decoding have specialized loops, and pure fixed-struct and homogeneous-array construction can use fast paths. Transformations, middleware, and declarations often keep interpreted callbacks while eligible nested schemas compile.

JIT resolves suspended schemas lazily. AOT does not evaluate suspend thunks, so schemas reached only through them stay interpreted unless installed as separate targets. Large or unsupported graphs keep their interpreter paths.

The interpreter, JIT, AOT, and `SchemaCompiler.set` share a registry keyed by exact AST identity; it stores parser functions, not parsed values. A consumer that already captured an entry keeps it after a replacement; later consumers see the new entry. Install compilers at startup, before parsers are created and used; each operation initializes independently.

Runtime parse options, including concurrency, still apply. Proxy inputs and modified built-in object behavior are outside the optimization contract. Optimized parsing gives check callbacks no permission to pause, fail through arbitrary channels, or perform observable work twice.

[Upstream page](https://effect.website/docs/v4/schema/compilers)
