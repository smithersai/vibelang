# Source maps

`vibelang` emits standard version 3 source maps pointing to `.vibe` lines. Enable `"sourceMap": true`, add `"inlineSources": true` to embed source text, and add `"declarationMap": true` for go-to-definition into built packages.

## What works where

Each row is verified against the tool itself:

| Tool | What works | Test |
| --- | --- | --- |
| Node | `--enable-source-maps` and `vibelang/register` print `.vibe` lines and columns | `node.test.mjs` |
| Debuggers | Breakpoints on `.vibe` lines pause over V8's inspector protocol | `inspector.test.mjs` |
| Bun | `vibelang/bun` prints `.vibe` lines (see [Limits](#limits)) | `bun.test.mjs` |
| Vite | Dev server modules, SSR stacks (including compiler-cache writes), and `vite build` | `vite.test.mjs`, `bundlers.test.mjs` |
| Vitest | Failing test stacks (including `@effect/vitest`) and V8/Istanbul coverage | `vitest.test.mjs` |
| esbuild, Rollup, Rolldown, webpack | Bundle maps reach `.vibe` text and Node prints `.vibe` frames | `bundlers.test.mjs` |
| Rspack | Bundle maps reach `.vibe` text | `packages/unplugin/test/bundlers.test.mjs` |
| Metro, Babel | Bundle maps name `.vibe` lines | `packages/compiler/test/tools/metro.test.mjs` |
| Error trackers | Minified production stacks resolve to `.vibe` lines and source context (including `@sentry/vite-plugin` debug IDs) | `production.test.mjs` |
| Editors | Go to definition from a built package import reaches `.vibe` declarations in both VibeLang's LSP and `tsserver` | `language-server.test.mjs` |

Position and coverage notes:

- **Jumps and `match` cleanup:** `return`, `break`, and `continue` leaving a `provide` or scoped region keep their authored positions. Coverage excludes compiler-generated completion tests, jump transfers, and `match` cleanup statements (including inside `catch effect`), while unvisited source functions and arms remain uncovered.
- **Inlined temporaries, keys, and `new.target`:** When a bundler inlines a string held in a compiler temporary, the composed map may point to the string or temporary's source expression (even through chained copies or generated imports sharing a module name, including dynamic imports). Service key strings keep their written positions (the erased `key` metadata name and generated producer properties do not map to written tokens). Captured `new.target` reads keep their written token positions, including in constructors across Unicode text and line endings.

## Limits

- **Bun's runtime:** Bun reads a source map only from a module it runs without transpiling. `vibelang/bun` meets that condition when the emitted JavaScript is ASCII and needs nothing from Bun's transpiler: no remaining JSX, no decorators at `target: "ESNext"`, no `require`/`__dirname`/`__filename`, and no `--define` or `bunfig.toml` `[define]` replacements. Otherwise, stack frames name the `.vibe` file with compiled JavaScript line numbers.
- **`Bun.build`:** Ignores plugin source maps, so bundle maps point to compiled JavaScript.
- **Compiled output under Bun:** `bun dist/main.js` does not read adjacent maps for plain JavaScript, so stacks name the emitted file.
- **Sidecars:** `x.d.vibe.ts` sidecars have no map, so stock `tsserver` go-to-definition stops at the sidecar for relative `.vibe` imports (VibeLang's language server reaches the source; built `.d.ts` maps reach the source in both).
- **Names:** `names` is empty (matching `tsc`), so debuggers show emitted names such as `$do1` where lowering introduced one.
- **Line ends:** `U+2028` and `U+2029` terminate lines, as in JavaScript.
- **Stacks:** JavaScript stacks show only the active frame above Effect's run loop; use spans for the logical call chain.
