# VIP-40: `module` declarations, TypeScript inside a `.vibe` file

**Status:** accepted, 2026-11-03. Will: "Are you asking me if I accept a vip I already asked you to add?" Replaces denied [VIP-25](0025-inline-modules-denied.md).

**One sentence.** `module name { … }` at a `.vibe` file's top level is a TC39 module declaration whose body is a TypeScript module, checked, emitted, declared, linted and formatted exactly as a sibling `.ts` file would be, and imported only with `import … from name`.

**One paragraph.** Will's ruling of 2026-10-31 removes `throw` from sync VibeLang functions: code that throws, catches native exceptions or wraps a throwing API lives in TypeScript, "in a ts module using module syntax" or "a ts file you import into vibelang". VIP-25 denied the inline form because plain functions kept TypeScript's `throw`; that reason is gone. This VIP restores old VibeLang's D283 escape with its D364/D403 semantics, which main still implements (50 `.vibe` files and 18 `module-declaration-*` cases), and corrects the three places where that implementation disagrees with TC39. It adopts only the named, top-level, unexported declaration. Everything else TC39 offers (module expressions, exported and nested declarations, the name as a `Module` value, a body naming a sibling declaration) is a compile error, so adding any of it later breaks nothing.

## Decision

```ts
// config.vibe
module parse {
  import { readFileSync } from "node:fs"

  /** @throws {RangeError} */
  export function port(raw: string): number {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new RangeError(`bad port: ${raw}`)
    return n
  }

  export function readText(path: string): string {   // no @throws: throws unknown
    try {
      return readFileSync(path, "utf8")
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return ""
      throw e
    }
  }
}

import { port, readText } from parse

error BadPort { raw: string }

export effect function loadPort(raw: string) {
  return try Effect.try({ try: () => port(raw), catch: () => new BadPort({ raw }) })
}

export function label(raw: string): string {
  return `port ${port(raw)}`      // error: plain code calls port, which @throws RangeError
}
```

```ts
// Effect TypeScript: the body is a file of its own, unchanged
// parse.ts
import { readFileSync } from "node:fs"
/** @throws {RangeError} */
export function port(raw: string): number { /* as above */ }
export function readText(path: string): string { /* as above */ }

// config.ts
import { Data, Effect } from "effect"
import { port, readText } from "./parse.ts"
class BadPort extends Data.TaggedError("BadPort")<{ readonly raw: string }> {}
export function loadPort(raw: string) {
  return Effect.gen(function* () { return yield* Effect.try({ try: () => port(raw), catch: () => new BadPort({ raw }) }) })
}
export function label(raw: string): string { return `port ${port(raw)}` }  // compiles; may throw
```

*Corrected 2026-11-03: the counterpart keeps `loadPort` a function declaration returning `Effect.gen`, and `BadPort` unexported, as the source writes them: VIP-1 puts `effect` "exactly where TypeScript allows `async`", and [Functions](../src/001-functions.md#meaning) says "A declaration stays a hoisted function declaration".*

The rule that decides every detail below:

> **A body is a TypeScript file stored inside a `.vibe` file.** Moving the body to a sibling `.ts` file (`.tsx` for a body in `.vibex`), preserving its external-module classification as specified below, and replacing `from name` with that file's string specifier changes no diagnostic, type, emitted statement, declaration or run-time observation. Apart from the empty module marker needed to preserve that classification, the move is a copy: no VibeLang syntax, no identifier specifier, no `import.meta`.

The rule is falsifiable by a differential test: compile every TypeScript module of the corpus once as a body and once as a sibling `.ts` or `.tsx` of the same source kind, preserving external-module classification in both, and compare.

**Module classification.** A body is always an external module before binding and checking, even without a written import or export and regardless of `moduleDetection`. This follows its TC39 `ModuleBody` grammar and the no-shared-lexical-scope rule below. Its virtual TypeScript source, JavaScript output and declaration output preserve that classification, with an effective empty module marker when needed. The extracted `.ts`/`.tsx` twin and the move refactor add `export {}` when the unchanged body would otherwise be a script under the project's options. The marker exports no names; ordinary TypeScript module-option diagnostics still apply. A side-effect import in the containing file does not classify the body as a module.

For example, `module privateState { const privateBodyValue = 7 }` imported by `import privateState;` keeps `privateBodyValue` private even with `moduleDetection: "legacy"`. Its extracted twin is:

```ts
// module-extraction-twin
const privateBodyValue = 7
export {}
```

A consumer containing `import "./privateState.js"; export const leaked = privateBodyValue` reports `TS2304` in both forms. Without the empty export, stock TypeScript treats the extracted file as a script and admits that leaked name, so the unchanged copy is not the twin.


## Syntax

```
ModuleDeclaration :                                    VIP-40 (TC39 module declarations, restricted)
  "module" [no LineTerminator here] BindingIdentifier "{" ModuleBody? "}"
        a top-level statement of a .vibe or .vibex file only; ModuleBody is TypeScript

ModuleSpecifier :                                      in VibeLang code of the same file only
  StringLiteral
  IdentifierReference                                  names a ModuleDeclaration of the same file

ImportDeclaration :
  ...
  "import" ModuleSpecifier ";"                         import name;  evaluates the body for its effects
```

This is TC39's grammar ([proposal-module-declarations](https://github.com/tc39/proposal-module-declarations) at `bca890b39bb7`, stage 2: `ModuleDeclaration : module [no LineTerminator here] Identifier { ModuleBody? }`) restricted to one placement. The parser commits on `module`, an identifier on the same line, then `{` (a line break before `{` is allowed, as in TC39).

- **`module` stays an identifier everywhere else.** `const module = …`, `module.x`, `module(…)` and `module`⏎`{ }` parse as today (probe `ident` compiles). No valid JavaScript or TypeScript program has an identifier directly followed by an identifier and `{`, so the production takes no existing text away.
- **`.vibex`.** A body in a `.vibex` file is TSX, as VIP-39 makes the whole file; in a `.vibe` file it is TS.

## The body is TypeScript

The body is parsed, bound and checked as a `.ts` (or `.tsx`) source file of its own, under the containing project's `compilerOptions`, by the TypeScript 7 checker the compiler forks.

| Form | Meaning in a body |
| --- | --- |
| `throw e` | JavaScript's `throw`. Never `Effect.fail`. |
| `try { } catch (e) { } finally { }` | JavaScript's statement; `e` is `unknown` under `useUnknownInCatchVariables`. |
| `async`, `await`, top-level `await` | JavaScript's. A top-level `await` makes the body, and every module that imports it, async, as ECMAScript specifies. Awaiting an Effect object does what it does in `.ts`. |
| `function*`, `yield`, `Promise`, `var`, `arguments`, `eval` | JavaScript's, as in `.ts`. VIP-1's legacy-JavaScript ban covers VibeLang code, not bodies. `with` stays a strict-mode error. |
| `enum`, `namespace`, `declare`, decorators, parameter properties | TypeScript's, under `erasableSyntaxOnly` and `isolatedModules` as in `.ts`. |
| `node:*`, `process`, `fetch`, `console`, timers | Allowed and typed by the project's `lib` and `types`, as in `.ts`. VIP-33 covers VibeLang code, not bodies. |
| Effect | Not in scope. A body imports what it uses (`import { Effect } from "effect"`); VIP-6, VIP-14, `vibe.effectGlobals` and the prelude do not apply. |

**VibeLang forms are unavailable** in a body, and each gets TypeScript's own syntax or name error (VIP-34 rule 1: native syntax keeps native errors): `effect` functions, arrows, methods, blocks and producers; `try` as an expression and `try.all` and friends; `catch` as an expression; `throw` as a failure; `match`, `is` patterns, `do { }` expressions and `|>`; `fork`, `join`, `for concurrent`, `for try`, interruption blocks, `provide`; `error`, `schema`, `data` and `service` declarations; the `A!E!R` shorthand. Words like `effect`, `fork` or `module` used as names, `is` type predicates and `!` non-null keep their TypeScript meaning.

**No VibeLang rule runs on a body**, except this VIP's `EK4007`, `EK4008` and `EK4009`. The plain-function `throw` error, throw tracking, VIP-33's platform rules and every other `EK` rule are about VibeLang code. VIP-38's Effect lint reaches a body where it reaches a `.ts` file of the project.

### Scope

- **No shared lexical scope.** TC39: "there is no shared lexical scope between module declarations and the module that contains each other; they are simply side by side." A body sees the global scope and its own imports, nothing the `.vibe` file declares: no local, function, `error` class, import, type or service. Using one is TypeScript's `TS2304`.
- **A body reaches its `.vibe` file only by importing it**, with a string specifier: `import { BadPort } from "./config.vibe"`. That is an ordinary module cycle with ECMAScript's TDZ rules (case `module-declaration-live-bindings`).
- **A body cannot name a sibling declaration** (`import { x } from parse` inside `module env { }`) in this profile: `EK4007`. TC39 allows it (spec `InstantiateModuleDeclarations` passes outer declarations into each body), but the import is not TypeScript and breaks the copy rule. Share code through a `.ts` file, or merge the two bodies.
- **Relative specifiers resolve from the `.vibe` file's directory**, as TC39 specifies ("as if they were defined in the outer module").
- **Names are case-sensitive** (TC39, and old D364): `module Text` and `module text` are two modules, and `from Text` never resolves to `text`.

### When the body evaluates

A module declaration is a module record, so ECMAScript's module evaluation decides:

1. **Once at most** per realm, however many times it is imported.
2. **Only if imported for a value.** A body the file never imports, or imports only types from (`import type`, or imports TypeScript elides), never evaluates and emits no JavaScript; it is still checked. `import name;` evaluates it for effects.
3. **In import order.** The file's source dependencies, its module declarations among them, evaluate in the order of its import and re-export declarations, then the file's own body. A required matcher initialization dependency precedes those source dependencies ([VIP-31](0031-runtime-guarantees.md)); a TypeScript body arranges its own initialization before using `Symbol.customMatcher`, as a sibling `.ts` file would. Declarations are hoisted: `import { port } from parse` above `module parse { }` is ordinary (case `module-declaration-order`).
4. **Live bindings.** An `export let` the body reassigns is seen by the importer (case `module-declaration-live-bindings`).
5. **Failure.** An uncaught `throw` or rejected top-level `await` fails module evaluation, before any effect code runs, as for a `.ts` import; it is never an Effect error. Retryable initialization belongs in an exported function called through `Effect.try`.

### Exports and imports

```ts
// VibeLang                                     // Effect TypeScript with ./text.ts
import Counter, { clean, Mode } from text       import Counter, { clean, Mode } from "./text.ts"
import * as tools from text                     import * as tools from "./text.ts"
import type { Shape } from text                 import type { Shape } from "./text.ts"
import text                                     import "./text.ts"
export { clean as tidy } from text              export { clean as tidy } from "./text.ts"
export type { Shape } from text                 export type { Shape } from "./text.ts"
export * from text                              export * from "./text.ts"
export * as textTools from text                 export * as textTools from "./text.ts"
```

- **The declaration is never exported.** `export module text { }` is `EK4002`; re-export the members instead.
- **The name is not a value.** TC39 binds it to a `Module` object for `import(text)` and workers; no runtime ships one. `import(text)`, `text.clean`, `typeof text` and `f(text)` are `EK4004`.
- **The name is a lexical binding of the file.** TC39 makes `module text {}` beside `const text = 1`, an import `text` or another `module text` a redeclaration SyntaxError; VibeLang reports `EK4005`, an error. Old VibeLang warned (D303).
- **Specifiers.** An identifier specifier naming no declaration of the file, or carrying import attributes, is `EK4006`. A string specifier is always a file or package: `from "text"` imports the package `text`.

## Thrown types reach VibeLang exactly as from an imported `.ts` file

Will, 2026-10-31: `@throws` and thrown-type tracking exist only for functions imported from `.ts`/`.js` files "and, once its VIP is accepted, code inside a TypeScript `module` block". This VIP makes the second case identical to the first:

1. **A body's callables are foreign callables** (VIP-4, "foreign callables", decided details 37, 38, 66). Each exported function, function-typed `const`, method and overload signature throws `unknown` unless it carries JSDoc `@throws {T}`, and rethrows a callback only with `@rethrows p`.
2. **Nothing is inferred from the body.** VibeLang does not read a `.ts` file's `throw` statements, so it does not read a body's. `readText` above throws `unknown`. A written `@throws` is trusted, not checked, as in `.ts`.
3. **Effect code wraps every call that may throw.** `port(raw)` unwrapped in effect code is VIP-4's error. `try Effect.try(() => port(raw))` fails with `Cause.UnknownError` (probe `p1`, effect 4.1.1); the `{ try, catch }` form maps the thrown value. A Promise-returning body function is wrapped with `Effect.tryPromise`; its `@throws` describes the synchronous call, not the Promise.
4. **Plain VibeLang code may not call a function known to throw.** `label` above calls `port`, whose `@throws {RangeError}` is tracked, so the call is the ruling's error, with the fix "make `label` an `effect` function and run the call with `try Effect.try(…)`". A call of `readText`, whose throwing is unknown, stays an ordinary call. Its unannotated signature still has thrown type `unknown`, so effect code requires the wrapper in rule 3. A written `@throws {unknown}` is a known throwing contract and follows the plain-code rejection above. A call inside the `try` block of a `try` statement with a `catch` clause in the same function is allowed, since it cannot throw out of the function: `function safePort(raw: string) { try { return port(raw) } catch { return 0 } }` compiles (the 2026-10-31 no-throw design's syntactic exemption).
5. **`@throws {never}`** lets VibeLang call a body function directly, as for a `.ts` function.
6. **Re-exports keep the contract.** `export { port } from parse` re-exports a foreign callable; `.vibe` and `.ts` consumers read the same `@throws` from the declaration files, and a VibeLang wrapper cannot launder it.
7. **`async` VibeLang functions** may throw (decided detail 251); that changes nothing here, because a body is TypeScript either way.

## Emit, declarations, source maps

- **One JavaScript module per body,** beside the file's output, as D403 and main do. `main.vibe` with `module parse` emits `main.js` and `main.vibe.parse.js`, and `main.js` imports `"./main.vibe.parse.js"` where the source wrote `parse`. A separate module is the one lowering whose order, liveness, TDZ, cycles and top-level `await` are ECMAScript's by construction; old VibeLang's two inline lowerings each broke one (D303's snapshot exports, fixed by D364; hoisted body imports running out of order, fixed by D403). A body in `main.vibex` uses the source basename `main.vibex`, so `module parse` emits `main.vibex.parse.jsx` under `"jsx": "preserve"`, or `main.vibex.parse.js` with transformed JSX, as TypeScript does for `.tsx`.
- **File names keep the exact name.** The name part encodes the decoded identifier's Unicode code points without case folding or Unicode normalization. It keeps `a`–`z`, `0`–`9` and `_`, and writes every other code point as `-`, its code point in lowercase hexadecimal without leading zeros, and `-` (`Text` → `-54-ext`, `Über` → `-dc-ber`, `$x` → `-24-x`). Identifier escapes and their literal characters have the same decoded name. The output stem is the source file's full basename, including `.vibe` or `.vibex`, followed by `.` and the encoded name: `main.vibe.-dc-ber` or `main.vibex.-dc-ber`. JavaScript, declaration and map outputs, and generated references to them, share that stem. The encoding is injective within one parent: case-only and Unicode-normalization twins get different ASCII filenames on every file system, and names containing only the retained characters are unchanged. Main lower-cases the name today, so `module Text` and `module text` collide and `from text` resolves to `Text`'s body (probe `case2`, rerun: `EK4408` plus `TS2305`).
- **CommonJS.** Under CommonJS emit the body is a CommonJS module that `main.js` requires, as a sibling `.ts` would be (case `module-declaration-cjs`). `export =` and `import x = require()` in a body are `EK4008` under any emit: a TC39 module body has no such forms.
- **Declarations.** A body's declarations are TypeScript's own declaration emit of it, `main.vibe.parse.d.ts` beside `main.d.ts`, with JSDoc (`@throws` included) as TypeScript writes it. The canonical stem also gives `main.vibex.parse.d.ts` and `main.vibe.-dc-ber.d.ts` for the examples above. When the file's VIP-27 sidecar `main.d.vibe.ts` refers to the body, `main.vibe.parse.d.ts` is also written beside that sidecar, so stock `tsc` resolves the sidecar's relative import from the sidecar's actual location: beside `main.vibe` by default, or at the mirrored path under `vibe.sidecarDir` ([VIP-27](0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)). That copy is a compatibility declaration, an emit output as the sidecar is ([VIP-27](0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02)): `include` and default-glob discovery leave it out while `main.vibe` declares the body, as a sibling `main.vibe.parse.ts` would, and a rebuild regenerates it; listed explicitly in `files`, it stays an input, and the write reports `TS5055`. A declaration file cannot hold the body inline (`declare module "./x"` with a relative name is `TS2436`).
- **Source maps.** The body's virtual source is the `.vibe` text with everything outside the body blanked, so offsets, lines and columns are the `.vibe` file's. `main.vibe.parse.js.map` and `.d.ts.map` name `main.vibe` with its full `sourcesContent`.
- **`import.meta` is `EK4009` anywhere in a body.** TC39 says a body's `import.meta.url` is the containing module's; the separate file's is its own (probe `p1`, rerun: `main.vibe.meta.js`, `import.meta.main` false). No body in main's 50 files uses it. A body that needs metadata receives it as an argument or lives in a `.ts` file.
- **Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version. An edit to a body invalidates its output and its importers.

## Tooling

Each tool reads a body as the `.ts` file it is, mapped into the `.vibe` file through TypeScript 7's content-mapper seam (`ast.ContentMapperSourceFileInfo`), as main does.

- **Checker and LSP.** Diagnostics, hover, completion, signature help, definition, references and rename work in the body with TypeScript's behavior and across the boundary: renaming `port` in the body renames `import { port } from parse`; renaming `parse` renames identifier specifiers only. Code actions in a body are TypeScript's; "add import" inside a body edits the body. The editor's retired-module refusals (`ls/retired_modules.go` and its calls in `organizeimports.go`, `rename.go`) are removed. A native error in a body is reported once.
- **Formatter.** VibeLang's one formatter (VIP-34) formats the body as `.ts`/`.tsx` with the repository's settings, indented one level, without sorting its imports (D372). It never moves code into or out of a body.
- **Linters.** The ESLint parser gives the declaration a `VibeModuleDeclaration { id, body }` node whose statements are typescript-estree's, with its own scope (main: `packages/compiler/eslint.mjs`), so typescript-eslint rules read it as TypeScript and VibeLang "prefer VibeLang syntax" rules skip it. Oxlint's JS-plugin rules apply where they apply to `.ts`. Knip counts the body's imports and unused exports.
- **TypeScript mapper.** The one-file projector for stock TypeScript tools refuses bodies today (`EK9100`). It projects each body as its own virtual `.ts` file.
- **Refactor *Move module to a TypeScript file*.** Writes a body from `.vibe` to `parse.ts`, or a body from `.vibex` to `parse.tsx`, beside the containing file (another name if taken, compared case-insensitively), adds `export {}` if needed to preserve external-module classification, and rewrites identifier specifiers, including side-effect imports, to the string specifier. Valid under the classification-preserving copy rule. Offered in the editor, never run by `--fix`.

For example, extracting `module view { export const element = <div /> }` from `main.vibex` writes `view.tsx`, retaining TypeScript's JSX language variant even if a particular body has no JSX. The body is copied as:

```tsx
// fragment: JSX types come from the project's framework
// module-extraction-twin
export const element = <div />
```

Writing these same tokens to `view.ts` instead reports TypeScript's `TS1005`; a `jsx` compiler option does not turn a `.ts` file into a `.tsx` file.

## Diagnostics

VIP-34 gives VIP-40 the `EK40xx` block. Old `EK4407` and `EK4408` are retired.

| Code | Rule | Fix |
| --- | --- | --- |
| EK4001 | A module declaration below the file's top level: in a block, function, class or `provide` | Move it to the top level |
| EK4002 | `export module name { }` or `export default module { }` | `export { … } from name` |
| EK4003 | A module expression `module { … }` | Name it: `module name { … }`, and import from it |
| EK4004 | The module's name used as a value: `import(name)`, `name.x`, `typeof name`, an argument | A static import from `name`, or a `.ts` file and `import()` of it |
| EK4005 | The name redeclares a binding of the file: a `const`, function, class, import or another module | Rename one |
| EK4006 | An identifier specifier that names no module declaration of the file, or carries import attributes | Fix the name, declare the module, or quote a package name |
| EK4007 | An identifier specifier inside a body (a sibling module) | Move the shared code to a `.ts` file, or merge the bodies |
| EK4008 | `export =` or `import x = require()` in a body | `export default`, `import` |
| EK4009 | `import.meta` in a body | Pass the value in, or use a `.ts` file |

**TypeScript's codes stay**: `module A.B { }`, `declare module C { }` and any other identifier-named `module` that is not this production are TypeScript namespaces and get `TS1540` alone. `declare module "x" { }` is unchanged. Every error inside a body is its `TS` code at its `.vibe` position.

## Clashes

The same text, `module X { … }`, has three readings:

| | TC39 module declaration | TypeScript namespace `module X {}` | `.vibe` (this VIP) |
| --- | --- | --- | --- |
| `X` is | a `const` holding a `Module` object | the namespace object (an IIFE) | not a value (`EK4004`) |
| Body sees outer scope | no | yes, a closure | no |
| `import` in the body | ES imports, sibling declarations by name | `import a = N.b` aliases only | ES imports by string (`EK4007` for names) |
| `export` in the body | live module exports | properties of the object | live module exports |
| Used as | `import { a } from X`, `import(X)` | `X.a` | `import { a } from X` |
| Runs | when first imported; never otherwise | in place, as a statement | when first imported; never otherwise |
| Placement | any declaration position, nested, exportable | any statement position, nested | top level, unexported |
| Status | stage 2 | `TS1540` error in TypeScript 7 | this VIP |

| Text | In a `.vibe` file | Rule |
| --- | --- | --- |
| `module X { }` in a `.ts` file | `TS1540` (merge probe `ts-forms`, rerun: all four identifier-named forms, including `declare module C {}`) | Renaming `.ts` to `.vibe` cannot silently turn a namespace into a module: no `.ts` file that compiles under TypeScript 7 contains the text. A TypeScript 5.x file migrates with TypeScript's own fix "use `namespace`". |
| `module X { }` inside a body | `TS1540` | The body is TypeScript. |
| `module A.B { }`, `declare module C { }` | `TS1540` alone | Today main adds `EK4408` with the wrong help ("Write a namespace with namespace"). |
| `declare module "x" { }`, `declare global { }` | Unchanged | A quoted name is never this production. |
| `module.exports`, `module.id`, `const module`, `module(…)` | Identifiers, as today | `module.exports` in VibeLang code stays VIP-33's `EK4402`. In a body it is whatever it is in `.ts`. |
| `module`⏎`X { }`, `module`⏎`{ }` | Identifier statement, then a block | `[no LineTerminator here]`, as TC39 and TypeScript. |
| `namespace X { }` | A namespace of VibeLang code | Unchanged; not an escape. |
| `const text = 1` beside `module text { }` | `EK4005` error | TC39's redeclaration rule, decided by it, not asked (Will: decide by precedent). Main warns today, so case `module-declaration-collision-unused` becomes a `.fail` case; the quick fix renames the `const`. |
| `service X {`, `error X {`, `schema X {`, `data X {` | Unchanged | Same shape, different keyword; none overlaps. |

## Will's words

> "There should be a VIP for module. This is a tc39 feature we added and it was in our older version of vibelang before we started the new vip style vibelang and it should be added as a vip." (2026-10-31)

> "if a function throws it should be an effect. If you have some kind of exception it should be in a typescript module {} or in a ts file." "You can throw in ts. You can throw in a ts module using module syntax. You can throw in a ts file you import into vibelang. If you throw in vibelang itself in a sync function that's an error." (2026-10-31)

## Sources

- TC39 [module declarations](https://github.com/tc39/proposal-module-declarations) README and `spec.emu` at `bca890b39bb7` (stage 2); [module expressions](https://github.com/tc39/proposal-module-expressions) at `c58d50918de7` (stage 2).
