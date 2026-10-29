# Installation

```sh
npm create vibelang@latest my-app
cd my-app
npm run start
```

With Bun (optional):

```sh
bun create vibelang@latest my-app
cd my-app
bun run start
```

The native `vibelang` compiler compiles `.vibe` sources to JavaScript. Version 0.0.11 installs from npm.

> **For agents.** To set up VibeLang with a coding agent, give it this prompt:
>
> ```text
> Set up VibeLang in this project: read https://vibelang.sh/setup and follow it.
> ```
>
> The agent detects the project's package manager, build, and editor, and follows the matching steps in [Set up VibeLang](../setup.md), which you can read too.

## Prerequisites

Install Node 22.22.3 (22.x) or Node 24.11.1 or later. If you use Bun, use Bun 1.4 or later. Bun is optional. The compiler is a native binary: `vibelang` lists one package per platform as an optional dependency, and your package manager installs only the one that matches your machine:

| Platform | Package | Rehearsed for 0.0.11 |
| --- | --- | --- |
| macOS on Apple silicon | `vibelang-darwin-arm64` | No |
| macOS on Intel | `vibelang-darwin-x64` | No |
| Linux on x64 | `vibelang-linux-x64` | Yes |
| Linux on arm64 | `vibelang-linux-arm64` | No |

Version 0.0.11 publishes four native packages for macOS and Linux on arm64 and x64. Native Windows binaries are not available yet. Use WSL and follow the Linux instructions. The release rehearsal creates, starts and tests a starter with npm and Bun on Linux x64. The macOS and Linux arm64 binaries are cross-built but have not been rehearsed for this release.

Keep optional dependencies enabled: if an install skips them, as `npm install --omit=optional` does, `vibelang` cannot find its binary and exits with an error.

## Create a project

```sh
npm create vibelang@latest my-app
cd my-app
npm run start
npm run test
```

With Bun, use `bun create vibelang@latest my-app`, `bun run start` and `bun run test`. Either create command copies the starter into `my-app`, pins the VibeLang packages to the version that created it, and installs dependencies. `--no-install` skips installation; then run `npm install` (or `bun install`) in the project before building.

`npm run start` builds the project and prints:

```out
Hello, VibeLang!
Recovered from EmptyName
```

See [Getting Started](../013-getting-started.md) for the starter's files and [Running Effects](009-running-effects.md) for execution.

## Add VibeLang to an existing project

Before installing, add this transitive pin to `package.json` (npm and Bun both honor `overrides`):

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.0.6"
  }
}
```

This keeps the platform package from selecting a newer patch with a different Effect peer requirement.

```sh
bun add --exact vibelang-runtime@0.0.11 effect@4.0.6 @effect/platform-node@4.0.6
bun add -d --exact vibelang@0.0.11 vibelang-vite@0.0.11 vitest@5.0.5 @effect/vitest@4.0.6
```

With npm, run `npm install --save-exact` for the first line and `npm install --save-dev --save-exact` for the second.

| Package | Install as | Purpose |
| --- | --- | --- |
| `vibelang-runtime` | Dependency | The continuation kernel and helpers that compiled code imports |
| `effect`, `@effect/platform-node` | Dependency | Effect 4.0.6 and its Node platform |
| `vibelang` | Dev dependency | The compiler and language server, its native binary, and the VS Code extension |
| `vibelang-vite` | Dev dependency | Compiles `.vibe` modules for Vite and Vitest |
| `vitest`, `@effect/vitest` | Dev dependency | Vitest 5.0.5 and `@effect/vitest` 4.0.6 for tests |

`vibelang-runtime` requires `effect` 4.0.6 exactly. The runtime depends on Effect internals and checks the exact version at load. VibeLang follows Effect 4.0.6's defect precedence: a failure whose cleanup crashes is a defect. Read the [release notes](../setup/release-notes.md) before updating code that inspects causes or recovers mixed failures. Keep `effect`, `@effect/platform-node`, and `@effect/vitest` at 4.0.6, so the runtime and your program share one copy of `effect`. Keep `vibelang`, `vibelang-runtime`, and `vibelang-vite` at one version; they are released together.

Add a `tsconfig.json` that selects `.vibe` sources and emits Node ESM to `dist/`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "noEmitOnError": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.vibe"]
}
```

VibeLang reads `vibe.config.json` first, then `tsconfig.json`, then `jsconfig.json`. `vibe.config.json` accepts every tsconfig field. VibeLang's own options go in a top-level `"vibe"` section of whichever file it reads, which plain `tsc` ignores.

Add scripts to `package.json`, which must have `"type": "module"`:

```json
{
  "type": "module",
  "scripts": {
    "build": "vibelang",
    "start": "vibelang && node --enable-source-maps dist/main.js",
    "test": "vitest run"
  }
}
```

`src/main.vibe` calls its runner at the top level, as an Effect TypeScript program does: `NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))`. A function named `main` is an ordinary function.

`node --enable-source-maps` maps JavaScript locations back to `.vibe` lines. It does not add the logical caller chain. Function tracing defaults to `"none"`, so a defect can show only one frame. To add function spans, set this top-level option in `tsconfig.json` and rebuild:

```json
{
  "vibe": { "tracing": "exported" }
}
```

`"exported"` traces exported functions; `"all"` traces local functions too. For a sparse failure message or a missing caller stack, follow [Debug stack traces](012-devtools.md#debug-stack-traces).

Keep source tests out of the build output. Add `tsconfig.test.json` so Vitest also checks and compiles those files:

```json
{
  "extends": "./tsconfig.json",
  "exclude": []
}
```

Test `.vibe` files through the Vite plugin:

```ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang({ project: "tsconfig.test.json" })],
  test: { include: ["src/**/*.test.vibe"] }
})
```

The plugin compiles the project that `tsconfig.json` describes, so keep `"rewriteRelativeImportExtensions": true` from the configuration above: without it, a `.ts` file that imports a `.vibe` module fails with TS5097. If your `tsconfig.json` has `"files": []` and only lists `references`, as Vite's templates do, pass the referenced configuration that includes your sources: `vibelang({ project: "tsconfig.app.json" })`. [Vite and Vitest](../setup/vite.md) covers the setup step by step.

To update, install the new version of all three VibeLang packages together:

```sh
bun add vibelang-runtime@latest
bun add -d vibelang@latest vibelang-vite@latest
```

VibeLang is v0, so a new version can change the language in breaking ways. Read the [release notes](../setup/release-notes.md) before updating.

## Configure your editor

From the project directory, after installing dependencies:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
# Or, for Cursor:
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

Open the project directory. The extension starts the project's compiler as the language server, `vibelang --lsp --stdio`, for diagnostics, hovers, and completions. It is not on the VS Code Marketplace or Open VSX yet; reinstall it from `node_modules` after you update `vibelang`.

Other editors run `vibelang --lsp --stdio` through their LSP client for `.vibe` and `.ts` files. See [Devtools](012-devtools.md).

## Compiler commands

From a project, run:

```sh
bun run build
bun run dev
bun run test
bun x --no-install vibelang --noEmit
```

The compiler writes `x.d.vibe.ts` beside each `x.vibe`, so stock `tsc`, TypeDoc and `bun check` resolve `.vibe` imports through `allowArbitraryExtensions`. Each exported function, method or constructor that doesn't return an Effect, a Stream or a Layer carries `@throws` in its declaration: what it may throw, or `@throws {never}`. An `effect` function, or one that returns a Stream or a Layer, carries none, because calling it can't throw; getters and setters carry none either. Set `"declaration": true` in `compilerOptions` to also emit `.d.ts` files to `dist/`. The starter leaves this option off. The starter's `tsconfig.json` selects `.vibe` and TypeScript files under `src/`, excludes `*.test.vibe` from the build, emits Node ESM to `dist/`, enables strict checking and source maps, and prevents emit on errors. Local source imports use `.vibe`; generated JavaScript and declaration files import `.js`, so a TypeScript project that installs your package resolves each module's declarations. `vibelang` accepts TypeScript compiler flags such as `--noEmit`, `--watch`, and `-b`.

### TypeScript declaration consumers

A downstream project using stock `tsc` needs **TypeScript 5.7 or later** for declarations built against the pinned `effect@4.0.6`. Effect's declarations use generic typed arrays such as `Uint8Array<ArrayBuffer>`, introduced in TypeScript 5.7; TypeScript 5.6 and earlier report errors such as “Type 'Uint8Array' is not generic.” This consumer requirement is separate from VibeLang's TypeScript 7.1 checker. Upgrade the consumer's `typescript` dependency; `skipLibCheck` can hide library errors but is not compatibility support. The declarations import their service and error brands from `vibelang-runtime`, so a consumer installs it beside `effect`; [Services and errors from TypeScript](../vibelang-features/114-vibelang-for-effect-users.md#services-and-errors-from-typescript) shows how a TypeScript consumer implements a service and catches an error.

## Coming from Effect

Install `vibelang` to compile `.vibe` and `vibelang-runtime` beside `effect@4.0.6`. Write application logic in `.vibe` and keep ordinary TypeScript integrations in `.ts`; the compiler checks both file types as one program.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/installation)
