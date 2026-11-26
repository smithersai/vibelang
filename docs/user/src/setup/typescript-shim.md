# VibeLang in .ts files

`vibelang-typescript` is an experimental source-checkout preview of [VIP-42](https://github.com/smithersai/vibelang/blob/main/docs/design/vips/0042-vibelang-in-ts-files-open.md) and is not published to npm. Use [the regular `.vibe` integration](existing-project.md) whenever you can rename files.

The compiler treats a `.ts` file whose first line is `// @vibe` as VibeLang and installs under the name `typescript` so existing `tsc` scripts reach it; unmarked files stay TypeScript. Use this only as a last resort: the [`vibelang` CLI](vibelang-cli.md), [Vite and Vitest](vite.md), and [Set up VibeLang](../setup.md) plugins keep stock TypeScript tools intact, whereas stock parsers ignore `// @vibe` and can reject syntax or compile with different semantics.

## Install

`vibelang-typescript` is not currently available from npm—use the source-checkout preview below. Because the checkout targets TypeScript 7.1, migrate TypeScript 5/6 projects (and their configs) to 7.1 first.

## Source checkout preview

With Go, Bun, and Node installed ([contributor setup](https://github.com/smithersai/vibelang/blob/main/CONTRIBUTING.md)), build from the repository root:

```sh
export VIBELANG_CHECKOUT="$PWD"
(cd docs/tools && bun install --frozen-lockfile)
(cd packages/runtime && bun install --frozen-lockfile && bun run build)
sh scripts/build-vibelang.sh
node packages/compiler/bin/vibelang --version
```

In the same shell, switch to your target project, install Effect and the checkout runtime, and check marked files:

```sh
npm install --save-exact effect@4.1.1 "$VIBELANG_CHECKOUT/packages/runtime"
node "$VIBELANG_CHECKOUT/packages/compiler/bin/vibelang" --noEmit
```

Pass your project's normal compiler flags to the launcher.

## Write a file

Line 1 must be `// @vibe` (optional trailing spaces/tabs; a BOM or `#!` line may precede it). Any other text on that line—even past byte `4096`—turns it into an ordinary comment, leaving loaders and the formatter in TypeScript mode.

```ts
// @vibe
error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return `hello ${name}`
}

export effect function main() {
  const who = greet("") catch () => "nobody"
  return try greet(who)
}
```

Marked `.ts`/`.mts`/`.cts` files follow `.vibe` rules and marked `.tsx` files follow `.vibex` rules (including `EK` diagnostics), and plain TypeScript files import them normally. Three things remain TypeScript-specific:

| In a `// @vibe` file | Reason |
| --- | --- |
| Import paths follow `tsconfig.json` (`./plain.js`, or `./plain.ts` with `allowImportingTsExtensions`) | The file is a `.ts` file |
| No `module` declarations (`module text { }` reports `TS1540`); use a plain `.ts` file instead | TypeScript reserves that syntax |
| No declaration sidecar | Sidecars exist only for `.vibe` names |

## Tool compatibility

| Tool | With the shim |
| --- | --- |
| `tsc`, `tsc --watch`, `tsc -b` | Checks and emits both kinds of file |
| Editors running `tsc --lsp --stdio` | Diagnostics, hover, and formatting for both (including marked `.mts`, `.cts`, `.tsx`). In VS Code, set `"js/ts.tsdk.path": "node_modules/typescript/lib"` and accept the workspace version |
| Vite and Vitest | Add [`vibelang-vite`](vite.md) |
| webpack, Rspack, Rollup, Rolldown, esbuild | Add [`vibelang-unplugin`](https://www.npmjs.com/package/vibelang-unplugin#configure) |
| Node.js | `node --import vibelang/register src/main.ts` |
| `bun build`, Bun's test runner, Metro | Not supported; use `.vibe` files |
| `tsx`, `ts-node`, Node.js without `vibelang/register` | VibeLang syntax can fail to parse; accepted syntax uses the tool's own bindings |
| Stock TypeScript (e.g., from a dependency) | VibeLang syntax can report `TS1434`; TypeScript-compatible syntax can compile with different meaning. Installing stock `typescript` under another name also conflicts for the `tsc` binary |
| Prettier, ESLint, Oxlint, Knip | Can reject or misinterpret source: ignore `// @vibe` files and use `vibelang format` and `vibelang lint` |
| Consumers of TypeScript's JavaScript API | Fails: the package exports only `version` (affects `vue-tsc`, `svelte-check`, and `ngc`) |

Bundlers still need a plugin because esbuild and Oxc parse `.ts` directly rather than invoking `typescript`. Successful stock compilation does not prove identical semantics:

```ts
// @vibe
export const request = Request
```

With the DOM library enabled, both compilers accept this file: VibeLang binds `Request` to `effect/Request`, while stock TypeScript binds it to the web `Request` constructor. Emitted JS, declarations, and runtime values diverge silently (this prelude collision remains an open question in VIP-42). VibeLang also always treats marked files as modules, whereas stock TypeScript can treat import/export-free files as scripts.

## Return to stock TypeScript

Rewrite VibeLang forms and make implicit prelude bindings explicit before handing a marked file back to stock TypeScript, and verify emitted behavior even when stock `tsc` reports zero errors. Remaining VibeLang syntax produces parse errors such as `TS1434`.
