# VIP-42: VibeLang in `.ts` files (open)

**Status:** open, 2026-11-05. Listed for a decision; the compiler implements it behind the directive.

**One sentence.** A `.ts`, `.tsx`, `.mts` or `.cts` file whose first line is exactly `// @vibe` is a VibeLang source, so a project that can't rename its files keeps its names, its `tsc` and its editor.

**One paragraph.** `.vibe` stays the language's file kind, and the plugins stay the supported route. This is the fallback for a project that can't rename files. The directive changes one file. A file without it keeps TypeScript's verdict, byte for byte. The compiler decides from the file's name and its bytes alone, so no option can make the compiler, the language server and the formatter disagree. The npm package `vibelang-typescript` delivers the compiler under the name `typescript`, and a `.ts` file with the directive compiles with whatever already runs `tsc`.

## Decision

```ts
// @vibe
error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return `hello ${name}`
}
```

- **The directive.** The first line is exactly `// @vibe`. A byte order mark and a `#!` line may come before it, and spaces and tabs after it. `/* @vibe */`, `// @vibes`, a line below a licence comment, and every other spelling are ordinary comments.
- **The file kind.** With the directive, `.ts`, `.mts` and `.cts` are `.vibe`, and `.tsx` is `.vibex`. Every accepted VIP applies: VIP-30 (every source file is a module), VIP-33, VIP-14 and VIP-6, VIP-38, and the rest. A declaration file, a JavaScript file and a JSON file have no directive.
- **No option.** Nothing in `vibe.config.json`, `tsconfig.json` or `jsconfig.json` turns the directive on or off.
- **Stock TypeScript reads the same file.** Three things retain TypeScript's behavior. These restrictions do not guarantee equivalent meaning when both compilers accept the source:

| Form | In a `.ts` file with the directive | Why |
| --- | --- | --- |
| `module x { }` ([VIP-40](0040-module-declarations.md)) | Not a module declaration: `TS1540`, as in TypeScript | Stock TypeScript parses it as a legacy namespace. It would pass stock tools with another meaning |
| An exported zero-parameter `main` | An ordinary function, as [VIP-26](0026-top-level-and-main.md) says | Stock TypeScript runs nothing |
| Names and imports | `x.ts` emits `x.js`. A written `./y.ts` follows TypeScript's own checks (`TS5097`). No declaration sidecar | The file is a `.ts` file to every resolver |

- **Diagnostics.** `EK` diagnostics attach to the file. Their text keeps saying "`.vibe` file".
- **Delivery.** `vibelang-typescript` is an npm package with the bin `tsc` and the exports `.` and `./package.json`. A project aliases `typescript` to it. Its version is TypeScript's major and minor with its own patch, such as `7.1.11`, so a peer range such as `>=5` accepts it.

## What this changes

- **D266.** "A `.ts`, `.tsx`, `.mts`, or `.cts` file keeps TypeScript's verdict … regardless of project diagnostic options or inline directives." This VIP adds one exception: the directive. The rule keeps its reason. The compiler never reinterprets TypeScript, because a file with the directive isn't TypeScript.
- **[VIP-39](0039-vibex.md), Alternatives.** It rejected a per-file pragma because "every tool (LSP, bundlers, editors) keys the language on the extension before reading the file". That reason holds for a tool that has to understand VibeLang, and it's why `.vibe` stays the route. Here the tools keep reading `.ts` as `.ts`, and the only readers of the directive are the compiler and the plugins, which already read the file.
- **No existing code.** Plain `.ts` and `.vibe` compile as they did. A `.ts` file whose first line is already exactly `// @vibe` would change: no case in the repository's corpus has that line.

## Stock tools reading the same file

The directive is an ordinary comment to stock readers. VibeLang-only syntax can produce parse errors, but successful parsing or type checking does not establish equivalent meaning.

| Reader | Possible result |
| --- | --- |
| Stock `tsc` | VibeLang syntax can report `TS1434` and other errors; TypeScript-compatible syntax can compile successfully with different bindings |
| Vite without the plugin, esbuild, `tsx` | VibeLang syntax can fail to parse; accepted syntax uses the reader's own bindings and transformations |
| Node.js type stripping | VibeLang syntax can raise `SyntaxError`; accepted syntax runs with Node's bindings |

The initial corpus comparison inspected 3,510 `.vibe` files: 627 parsed as stock TypeScript, including 372 outside failing cases. Comparing those examples exposed differences in `module` declarations, the `$entry` runner, implicit imports, and script or module detection. That sample did not establish that implicit-import differences always fail loudly.

## Open question: prelude bindings in marked TypeScript

The current prelude can silently select another value for a name that stock TypeScript also accepts:

```ts
// @vibe
export const request = Request
```

With `target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `lib: ["ES2022", "DOM"]`, `strict: true`, `types: []`, `skipLibCheck: true`, `declaration: true`, and `noEmitOnError: true` in a module package, stock TypeScript `7.0.2` and VibeLang `0.0.11` both exit with status `0` without diagnostics. VibeLang emits an import of `effect/Request` and exports that module; stock TypeScript exports the global web `Request` constructor. Running the outputs gives `typeof request === "object"` and `typeof request === "function"`, respectively. Their declarations differ too.

This example explicitly exports a value, so the difference is independent of script or module detection. VIP-14 currently gives the Effect module precedence over the platform global. Whether marked TypeScript keeps that prelude behavior is an open acceptance question for this proposal. This document records the behavior and counterexample; it does not change the prelude.

The other direction is a twin sweep: every case compiled as written, and again with each `.vibe` renamed `.ts` behind the directive. See [the research](../../research/typescript-shim.md#twin-sweep).

## Alternatives

| Alternative | Why not |
| --- | --- |
| A content mapper | TypeScript refuses it: `TS18066`, "is a built-in extension and cannot be registered by a content mapper" |
| A glob in `"vibe"`, such as `"tsFiles": ["src/**/*.ts"]` | Every plugin needs TypeScript's glob matching, a file doesn't say what it is, and one file in two projects can mean two things |
| A config switch beside the directive | A second step with no reader. Every tool that has no project, such as the formatter, would need one |
| Parse as TypeScript, and fall back to VibeLang on a syntax error | A typo changes the language |
| `"use vibe"` | A string prologue is a statement: it survives into output and needs a parse. A comment on line one costs a prefix check |
| Rewriting `node_modules`, as `effect-tsgo patch` does | [The research](../../research/typescript-shim.md#design-twice) compares the two. An install undoes a patch, and a read-only store refuses it |

## Prior art

Flow's `// @flow`, opt-in per file inside `.js`. TypeScript's `// @ts-check` and `/** @jsx h */`. Deno's `/** @jsxImportSource */`. Effect's `@effect/tsgo` and `@effect/language-service` replace TypeScript in place. `npm:` aliases are how TypeScript 7 itself keeps `@typescript/typescript6` beside `typescript`.

## Recommendation

The proposal remains open. Keeping `.ts` names with a real type checker is useful, but acceptance still requires a decision on the prelude collision above. The directive does not provide a guarantee that stock readers fail loudly or preserve meaning.
