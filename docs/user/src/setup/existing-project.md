# Add VibeLang to an existing project

Install VibeLang's packages in a project with a `package.json` and check that the compiler runs; then set up the build.

Call your own `.ts` functions and npm packages through `Effect.try` when they may throw, or `tryPromise` for Promises ([TypeScript boundaries](../vibelang-features/114-vibelang-for-effect-users.md#keep-platform-work-in-effect)). For example, import your parser and capture its input in the callback:

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-13, VIP-14
import { parseSettings } from "./settings.ts"
error BadSettings { cause: unknown }

effect function settings(text: string) {
  return try Effect.try({
    try: () => parseSettings(text),
    catch: (cause) => new BadSettings({ cause })
  })
}
```

Give a `.vibe` wrapper a different file stem from the `.ts` module it
wraps. For example, `settings.vibe` beside `settings.ts` both emit
`settings.js`, causing TS5056 in the CLI, Vite and Vitest. Name the wrapper
`load-settings.vibe` instead.

Use Effect services for platform, clock and randomness APIs, such as `Console`, `Clock` and `Random`. The compiler reports unwrapped foreign calls as `EK4401`, platform calls as `EK4402`, and the web's clock and randomness reads, such as `crypto.randomUUID()`, as `EK4403` ([diagnostics](../getting-started/012-devtools.md#diagnostics-completions-and-refactors)). A function that cannot throw can be called directly. Library declarations describe thrown types with `@throws {E}`. A missing annotation means the call may throw `unknown`.

## 1. Check package.json

`package.json` must have `"type": "module"`. Before adding it, check how this changes Node's loading of your project's `.js` files.

The VibeLang runtime requires `effect` 4.0.6 exactly. The runtime depends on Effect internals and checks the exact version at load. VibeLang follows Effect 4.0.6's defect precedence: a failure whose cleanup crashes is a defect. Read the [release notes](../setup/release-notes.md) before updating code that inspects causes or recovers mixed failures. If your project depends on another `effect` version, review the migration before changing it. Upgrade an existing project to the pinned Effect version first, fix any failures, and verify its tests. Convert files to `.vibe` only after the Effect upgrade passes.

## 2. Install the packages

Before installing, add this transitive pin to `package.json` (npm and Bun both honor `overrides`):

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.0.6"
  }
}
```

This keeps the platform package from selecting a newer patch with a different Effect peer requirement.

With Bun, run:

```sh
bun add --exact vibelang-runtime@0.0.11 effect@4.0.6 @effect/platform-node@4.0.6
bun add -d --exact vibelang@0.0.11 vibelang-vite@0.0.11 vitest@5.0.5 @effect/vitest@4.0.6
```

With npm, run:

```sh
npm install --save-exact vibelang-runtime@0.0.11 effect@4.0.6 @effect/platform-node@4.0.6
npm install --save-dev --save-exact vibelang@0.0.11 vibelang-vite@0.0.11 vitest@5.0.5 @effect/vitest@4.0.6
```

| Package | Install as | Purpose |
| --- | --- | --- |
| `vibelang-runtime` | Dependency | Small helpers used by compiled code |
| `effect`, `@effect/platform-node` | Dependency | Effect 4.0.6 and its Node platform |
| `vibelang` | Dev dependency | The compiler and language server, its native binary, and the VS Code extension |
| `vibelang-vite` | Dev dependency | Compiles `.vibe` modules for Vite and Vitest |
| `vitest`, `@effect/vitest` | Dev dependency | Vitest 5.0.5 and `@effect/vitest` 4.0.6 for tests |

Keep `effect`, `@effect/platform-node`, and `@effect/vitest` at 4.0.6. `vibelang`, `vibelang-runtime`, and `vibelang-vite` release together; keep them at one version.

Keep optional dependencies enabled: `vibelang` gets its native compiler from one optional dependency per platform, such as `vibelang-darwin-arm64`. If an install skips them, as `npm install --omit=optional` does, `vibelang` cannot find its binary and exits with an error.

VibeLang uses TypeScript 7, which rejects removed options such as `moduleResolution: "node"` / `"node10"` and `baseUrl` (TS5108 / TS5102); update an older tsconfig using the [TypeScript 7 migration notes](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md).

## 3. Check the compiler

```sh
npx vibelang --version
```

The output is:

```out
VibeLang 0.0.11 (TypeScript 7.1.0-dev)
```

## 4. Port Effect TypeScript files

Rename a `.ts` file that uses Effect to `.vibe`, then let the compiler rewrite it:

```sh
npx vibelang -p tsconfig.json --fix --noEmit
```

`--fix` applies each rewrite that keeps the program's meaning: Effect error and service classes become `error` and `service` declarations, `Effect.succeed` and `Effect.fail` become returned values and `throw`, catch combinators become `catch`, `Match` chains become `match`, Option pipes become module calls, prelude imports go, and an `Effect.gen` that is a function's whole body becomes an effect function with `try` replacing `yield*` ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). It refuses a rewrite that would change what other code receives, and prints why. An `Effect.gen` that the file pipes, such as `Effect.gen(...).pipe(Effect.provide(AppLive))`, stays EK1002 for now: write its body by hand inside `export effect function main() { provide AppLive { ... } }`, reading a service as `try Users`.

Support for the new forms and adjacent `.d.vibe.ts` declarations arrives with the compiler's VIP implementation.

## Next

If you use a coding agent, run `npx vibelang agents init` to give it the VibeLang skill, the language server and a check after each edit ([Coding agents](coding-agents.md)).

Set up the build: [React](react.md), [Vue](vue.md), or [Svelte](svelte.md) with Vite; [Vite and Vitest](vite.md) for other Vite or Vitest projects; [Build with the vibelang CLI](vibelang-cli.md) without a bundler. For another bundler, see step 3 of [Set up VibeLang](../setup.md).
