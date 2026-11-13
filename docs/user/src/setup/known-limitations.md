# Known limitations

VibeLang is in early alpha.

- Platforms: [macOS arm64/x64, Linux arm64/x64, Windows arm64/x64](../getting-started/004-installation.md#prerequisites). The npm and Bun starter rehearsal runs on Linux x64; the other five binaries are cross-built.
- Bun runtime: use `1.4.2` or newer for [complete source-loader support](vibelang-cli.md#run-sources-with-bun). Older versions can misresolve computed imports or corrupt Unicode import paths.
- Effect: [`effect@4.1.1` exactly](existing-project.md); other versions are unsupported.
- Stock TypeScript: run `vibelang` first to emit adjacent `.d.vibe.ts` declaration sidecars and the `.d.ts` files that re-export them, then enable `allowArbitraryExtensions` so stock TypeScript tools can [read `.vibe` imports](vibelang-cli.md#let-typescript-tools-read-vibe-modules), including a `.ts` file's `./x.js` import. These tools read the declarations; they do not check the VibeLang implementation. `vibelang-ts-mapper`, a TypeScript 7.1 content mapper that lets stock TypeScript check `.vibe` and `.vibex` files, is experimental and unpublished. It is tested with `typescript@7.1.0-beta`, which runs it only under `tsc --runExternalCode`. Add both extensions to `contentMappers.extensions` and set `compilerOptions.jsx` as for `.tsx`; the mapper preserves JSX for TypeScript to check.
- Editors: [VS Code and Cursor use the bundled VSIX](vscode.md). VS Code Marketplace and Open VSX publishing are not ready.
- Stability: [v0: breaking changes expected](release-notes.md). Read release notes before upgrading.

Vitest `5.1.0` cannot load tests when the absolute project path contains `#`, including plain TypeScript tests. [Use a project path without `#`](vibelang-cli.md#5-test-with-vitest).

Calls through `any` can hide an Effect and its failure and service channels.
EK4409 warns when an effectful body returns such a call. It also warns when a
function with an Effect contract requiring a primitive success value returns a local `const` call whose initializer
is known to be effectful, even if the containing function compiles to plain
JavaScript internally. The warning does not track arbitrary `any` values through
mutable assignments, containers, foreign APIs, or intermediate local values.
A hidden Effect can still be returned as an ordinary, unrun value. Keep the
callee's callable type, such as `() => number!NotFound`, instead of erasing it.

The experimental TypeScript mapper keeps an exported function’s written Effect contract, such as `number!!`, even when its body is pure. Its projected type has no `$plain` member.

After the supported CLI, plugins and editor routes, the experimental [TypeScript shim](typescript-shim.md) is a last resort for projects that cannot change TypeScript file names. Under open VIP-42, the `vibelang` compiler recognizes a `.ts` file whose first line is `// @vibe`; the `vibelang-typescript` replacement package that runs it as `tsc` is a source-checkout preview and is not published to npm. Stock readers can accept a marked file with different meaning.

Mapper failures `EK9001` through `EK9006` have [repair guidance in the diagnostic reference](../vibelang-features/diagnostic-code-map.md#typescript-mapper-failures).

In a `.vibex` file, `return` inside a `do` expression in a JSX attribute or child container reports `EK0204`, although [VIP-39](https://github.com/smithersai/vibelang/blob/main/docs/design/vips/0039-vibex.md) says it leaves the enclosing function. For example, `export function f() { return <Box v={do { return 7 }} /> }` fails. Move the `do` expression into a statement of its own before the element: `const v = do { return 7 }; return <Box v={v} />`.

With `declarationMap` on, the declaration map of a `module` body lists a source that is never written. For `module parse { … }` in `a.vibe`, `dist/a.vibe.parse.d.ts.map` has `"sources": ["../a.vibe.parse.ts", "../a.vibe"]`, and there is no `a.vibe.parse.ts`. The mappings use only `a.vibe`, so go-to-definition reaches the right file; a tool that checks every listed source reports the first one missing. Declaration maps also carry no `sourcesContent`, as with TypeScript's own `declarationMap`, even with `inlineSources`; only the JavaScript maps embed the source.

After `"type": "module"` is added to a project's `package.json`, `node --import vibelang/register` can keep running the CommonJS it compiled before, and fails with `ReferenceError: exports is not defined in ES module scope`. Run it once with `VIBELANG_DISABLE_CACHE=1` to compile it again; the next release keys the compile cache on the module format.

## The experimental opt-in

The opt-in marks which modules are supported in 0.0.13: `Durable`, `Human`, `Eval`, `Scorer`, `Memory`, `Fuzz`, `FuzzSimulation` and `Test` require `"vibe": { "experimental": ["builtins"] }`. It is a support boundary, not a security boundary: the check catches the direct uses below to prevent accidental use, but cannot stop a program that sets out to reach an open-proposal module. In 0.0.13, `EK3013` is guaranteed for the direct forms below; other routes to a gated module's exports can compile without the opt-in.

### What `EK3013` refuses

Without the opt-in, these direct forms report `EK3013` in a `.vibe` or `.vibex` file, outside `module` bodies:

- `task` and `workflow` declarations.
- A member access or qualified type query such as `Experimental.Durable` or `typeof Experimental.Durable`, including a member access through an alias whose type is the namespace itself, such as `const E = Experimental; E.Durable`. The same direct member accesses through the `Experimental` export of `vibelang-runtime` or a namespace import of `vibelang-runtime/experimental` report `EK3013`.
- Non-computed binding destructuring, such as `const { Durable } = Experimental`, and value element access with a key whose type is a single string literal, such as `Experimental["Durable"]`.
- `export *` of `vibelang-runtime/experimental`, and an import, re-export or dynamic `import()` whose specifier is a module's literal subpath.
- A direct `import type { Store } from "vibelang-runtime/experimental/Durable"` and `ReturnType<typeof Experimental.Durable.makeMemoryStore>`.

### Routes the check does not follow in 0.0.13

- Binding or importing the whole namespace without selecting a gated member passes. These obtain the namespace value without executing an experimental operation; adding `E.Durable` to these examples reports `EK3013`:
  - `const E = Experimental`
  - `import { Experimental as E } from "vibelang-runtime"`
  - `import * as E from "vibelang-runtime/experimental"`
- These value spellings compile and run without the opt-in:
  - an assignment pattern: `let D; ({ Durable: D } = Experimental)` obtains the `Durable` namespace without executing an experimental operation.
  - a computed name in a binding pattern: `const { ["Durable"]: D } = Experimental` obtains the same namespace without executing an experimental operation.
  - element access with a key typed as a union or a type parameter: `Experimental[k]` where `k: "Durable" | "Fuzz"` obtains the selected namespace without executing an experimental operation.
  - an asserted key whose type prevents resolution: `Experimental["Durable" as never]` obtains the `Durable` namespace without executing an experimental operation.
  - enumerating the namespace: `Object.entries(Experimental)` obtains its keys and values without executing an experimental operation.
  - a named import of the durable helpers from the runtime's internal entry: `import { $task } from "vibelang-runtime/internal"` obtains a helper function without calling it.
  - an import of a module's file by path: `import { memory } from "./node_modules/vibelang-runtime/dist/experimental/Durable.js"` obtains a runtime value without executing an experimental operation.
- A union-typed namespace alias passes: `const E = flag ? Experimental : { Durable: undefined }; return E.Durable`. With `flag` true, this returns the `Durable` namespace; a consumer can provide its `memory` and obtain a Durable engine without opting in, executing an experimental operation.
- A value alias with a namespace-derived type annotation also passes: `const E: Pick<typeof Experimental, "Durable"> = Experimental; const D = E.Durable`. A consumer can provide `D.memory` and obtain a Durable engine without opting in; this executes an experimental operation. The same consumer obtains an engine when the annotation is `Readonly<typeof Experimental>` or `{ Durable: (typeof Experimental)["Durable"] }`.
- The check misses indexed access types and types built from the namespace's type, including utility types, mapped types and conditional types. These nine type-only spellings compile without the opt-in; they are erased and no experimental operation runs:
  - `export type D = (typeof Experimental)["Durable"]`
  - `export type X = typeof Experimental["Durable"]`
  - `type NS = typeof Experimental; export type D = NS["Durable"]`
  - `export type P = Pick<typeof Experimental, "Durable">`
  - `export type K = keyof typeof Experimental`
  - `export type M = { [K in keyof typeof Experimental]: (typeof Experimental)[K] }`
  - `export type E = Extract<keyof typeof Experimental, "Durable">`
  - `export type O = Omit<typeof Experimental, "NetAddress">`
  - `export type C = typeof Experimental extends { Durable: infer D } ? D : never`
- Individual exports of a gated subpath pass through `.ts` and `.js` bridge files:
  - `export { memory } from "vibelang-runtime/experimental/Durable"` in `bridge.ts` or `bridge.js`, consumed by `import { memory } from "./bridge.js"` in a `.vibe` file, obtains a runtime value. The Node loader runs that consumer and `typeof memory` is `"object"`; merely reading that value executes no experimental operation.
  - Re-exporting `memory`, `Durable` and `TypeId` from that subpath through a `.ts` bridge lets a `.vibe` consumer provide `memory` and obtain a Durable engine without opting in. With that consumer, experimental operations run.
  - A declaration-file bridge also passes: `export type { Store as S } from "vibelang-runtime/experimental/Durable"` in `bridge.d.ts`, consumed by `import type { S } from "./bridge.js"` in a `.vibe` file. That reference is type-only and erased; no experimental operation runs.
  - A bridge that instead imports `* as selected` from the gated subpath and exports `selected` is refused when a `.vibe` file imports that namespace. Re-exports through another `.vibe` file are refused when that file imports or re-exports a gated subpath outside `module` bodies.
- An inline `module` bridge passes: `module bridge { export { memory, Durable, TypeId } from "vibelang-runtime/experimental/Durable" }; import { memory, Durable, TypeId } from bridge`. Its body is inline TypeScript; the opt-in check does not run on it. With the value import shown, a consumer can provide `memory` and obtain a Durable engine without opting in; this executes an experimental operation.
- The check cannot see a use whose target the compiler does not resolve, such as `(globalThis as any).Experimental`, `Reflect.get(Experimental, "Durable")` or a dynamic `import()` with a computed specifier. The first example reads an unresolved value; the latter two can obtain the `Durable` namespace, without executing an experimental operation in these examples.
- It does not check the uses inside `.ts` files or a dependency's JavaScript. A `.ts` or `.js` entry can import a gated subpath and an ordinary `.vibe` module without `EK3013`. These foreign-file routes can obtain runtime values; executing an experimental operation through them is also outside the check.

The next release closes the value routes that select a gated member; enumerating the whole namespace stays allowed until the owner decides, because a program that uses only core modules can write it. The next release closes gaps in type positions that resolve to a gated member. The next release closes the gaps in references from `.vibe` and `.vibex` files through these bridges.

These are the routes found so far, and the list is not complete; a program compiled without the opt-in is unsupported the moment it reaches any of the eight modules by any route, including type-only references.

`vibelang lint -p tsconfig.json` reads only `tsconfig.json`, as `vibelang -p tsconfig.json` does. With the opt-in only in `vibe.config.json`, both explicit `-p tsconfig.json` commands report `EK3013`; `vibelang` and `vibelang lint` without `-p` read `vibe.config.json` and pass. Put the opt-in in `tsconfig.json`, or omit `-p`.

## Specification examples the compiler does not pass yet

The specification marks each example the compiler does not pass yet with `// compiler-gap: pending VIP-N`, and the docs check fails as soon as such an example passes, so this list stays current:

- VIP-4: in effect code, `JSON.stringify(v)` and `s.repeat(n)` compile without `EK0403`, although the specification gives them the thrown types `TypeError` and `RangeError` ([Thrown types](../../../design/src/003-failures.md#thrown-types)). Wrap them yourself: `try Effect.try(() => JSON.stringify(v))`.
