# Source maps

A `return`, `break` or `continue` leaving a `provide` or scoped region keeps its authored source position. Coverage excludes the generated completion test and transfer that forward that jump.

`vibelang` writes standard version 3 source maps that name `.vibe` lines. Turn them on with `"sourceMap": true`. Add `"inlineSources": true` to carry the source text, and `"declarationMap": true` for go-to-definition into a built package.

## What works where

Each row is checked by driving the tool itself. The table names each test file.

| Tool | What works | Test |
| --- | --- | --- |
| Node | `--enable-source-maps` and `vibelang/register` print `.vibe` lines and columns | `node.test.mjs` |
| Debuggers | A breakpoint set on a `.vibe` line pauses there, over V8's inspector protocol | `inspector.test.mjs` |
| Bun | `vibelang/bun` prints `.vibe` lines, with the limits below | `bun.test.mjs` |
| Vite | The dev server's modules and SSR stacks, including compiler-cache writes, and `vite build` | `vite.test.mjs`, `bundlers.test.mjs` |
| Vitest | A failing test's stack, with `@effect/vitest` too, and coverage with the V8 and Istanbul providers | `vitest.test.mjs` |
| esbuild, Rollup, Rolldown, webpack | The bundle's map reaches `.vibe` text, and Node prints `.vibe` frames | `bundlers.test.mjs` |
| Rspack | The bundle's map reaches `.vibe` text | `packages/unplugin/test/bundlers.test.mjs` |
| Metro, Babel | The bundle's map names `.vibe` lines | `packages/compiler/test/tools/metro.test.mjs` |
| Error trackers | A minified production stack resolves to `.vibe` lines and source context, as Sentry does, through `@sentry/vite-plugin`'s debug IDs too | `production.test.mjs` |
| Editors | Go to definition from a built package's import reaches the `.vibe` declaration, in VibeLang's language server and in `tsserver` | `language-server.test.mjs` |

Bundlers can inline a string held in a compiler temporary. Its composed map may name the original string or the temporary's source expression. The checks retain that distinction when a generated import uses the same module name, including dynamic imports.

Service key strings keep their written positions. The `key` metadata name is erased; a generated producer property with the same name has no corresponding written token. Mapping checks distinguish these from retained object and class properties.

A `new.target` read captured by Effect lowering keeps its written token position, including in constructors and across Unicode text and line endings.

## Limits

- **Bun's runtime:** Bun reads a source map only from a module it runs without transpiling. `vibelang/bun` can do that for a module whose emitted JavaScript is ASCII and that needs nothing from Bun's transpiler: no JSX left in the output, no decorators at `target: "ESNext"`, no `require`, `__dirname` or `__filename`, and no name that `--define` or a `bunfig.toml` `[define]` table replaces. In any other module a stack frame names the `.vibe` file with the line of its compiled JavaScript.
- **`Bun.build`:** it ignores a plugin's source map, so a bundle's map points into each module's compiled JavaScript.
- **Compiled output under Bun:** `bun dist/main.js` reads no map beside plain JavaScript, so a stack names the emitted file.
- **Sidecars:** an `x.d.vibe.ts` sidecar has no map, so go-to-definition in stock `tsserver` stops at the sidecar for a relative `.vibe` import. VibeLang's language server reaches the source. A built package's `.d.ts` maps reach the source in both.
- **Names:** `names` is empty, as in `tsc`. A debugger shows an emitted name, such as `$do1`, where the lowering made one.
- **Line ends:** `U+2028` and `U+2029` end a line, as in JavaScript.
- **Stacks:** a JavaScript stack shows the active frame above Effect's run loop. Use spans for the logical call chain.

Coverage excludes the cleanup statements generated for `match`, including
inside a `catch effect` handler. Generated cleanup does not appear as an
uncovered source statement; an unvisited source function or arm remains uncovered.
