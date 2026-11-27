# Add VibeLang to an existing project

Install VibeLang in a project with an existing `package.json`, verify the compiler, then wire your build.

## TypeScript and npm boundaries

Call your own `.ts` functions and npm packages through `Effect.try` when they may throw, or `tryPromise` for Promises ([TypeScript boundaries](../vibelang-features/114-vibelang-for-effect-users.md#keep-platform-work-in-effect)):

```vibe
import { parseSettings } from "./settings.ts"
error BadSettings { cause: unknown }

effect function settings(text: string) {
  return try Effect.try({
    try: () => parseSettings(text),
    catch: (cause) => new BadSettings({ cause })
  })
}
```

- **Avoid stem collisions:** Do not place `settings.vibe` beside `settings.ts` — both emit `settings.js` (TS5056). Name the wrapper `load-settings.vibe`.
- **Throwing contracts:** For non-effectful foreign calls, `@throws {never}` permits a direct call; missing annotations mean `unknown` and non-`never` contracts require an `Effect.try` bridge in effect code (`EK0403`). A callable returning an `Effect`, `Stream` or `Layer` is effectful: call it directly, regardless of `@throws`. Run an Effect result with `try` rather than wrapping its factory in `Effect.try`.
- **Platform APIs:** Use Effect services (`Console`, `Clock`, `Random`) for platform, clock, and randomness APIs; direct host/web calls like `crypto.randomUUID()` report `EK4402` ([diagnostics](../getting-started/012-devtools.md#diagnostics-completions-and-refactors)).

## 1. Check package.json

- **ESM required:** `package.json` must set `"type": "module"`. Check how that affects any existing `.js` files first.
- **Supported Effect range (`^4.1.0`):** `vibelang` and `vibelang-runtime` support any stable `effect` version `>=4.1.0 <5.0.0` (tested on `4.1.6`), and reject `3.x`, `4.0.x`, `5.x`, and prereleases at compile and load time (`EK3201`). Core runtime constructs use public Effect 4 APIs, so no `@effect/platform-node-shared` override or resolution is required. VibeLang follows Effect 4.0.6's defect precedence, which Effect 4.1+ keeps: a failure whose cleanup crashes is a defect ([release notes](../setup/release-notes.md)). Upgrade your existing project to a stable Effect `^4.1.0` release (such as `effect@4.1.6`) and verify its tests pass before converting files to `.vibe`.
- **Published libraries:** Keep `vibelang-runtime` (and `vibelang` if launching source children via `vibelang/register` or `vibelang/bun`) in production `dependencies` at a registry version, not a local `file:` path.

## 2. Install the packages

No transitive `@effect/platform-node-shared` override or resolution is needed — any stable `^4.1.0` Effect release works out of the box.

Install with Bun:

```sh
bun add vibelang-runtime@0.0.15 effect@^4.1.6 @effect/platform-node@^4.1.6
bun add -d vibelang@0.0.15 vibelang-vite@0.0.15 vitest@5.1.0 @effect/vitest@^4.1.6
```

Or with npm:

```sh
npm install vibelang-runtime@0.0.15 effect@^4.1.6 @effect/platform-node@^4.1.6
npm install --save-dev vibelang@0.0.15 vibelang-vite@0.0.15 vitest@5.1.0 @effect/vitest@^4.1.6
```

With pnpm, allow `dprint`'s install script in `pnpm-workspace.yaml` (pnpm 11+ fails with `ERR_PNPM_IGNORED_BUILDS` otherwise):

```yaml
allowBuilds:
  dprint: true
```

```sh
pnpm add vibelang-runtime@0.0.15 effect@^4.1.6 @effect/platform-node@^4.1.6
pnpm add --save-dev vibelang@0.0.15 vibelang-vite@0.0.15 vitest@5.1.0 @effect/vitest@^4.1.6
```

**Yarn** — use the `node_modules` linker (Yarn 2+: add `nodeLinker: node-modules` to `.yarnrc.yml`) and install `vite` explicitly if not already on Vite 7 or 8:

```yaml
nodeLinker: node-modules
```

```sh
yarn add vibelang-runtime@0.0.15 effect@^4.1.6 @effect/platform-node@^4.1.6
yarn add --dev vibelang@0.0.15 vibelang-vite@0.0.15 vitest@5.1.0 @effect/vitest@^4.1.6
yarn add --dev vite@8
```

| Package | Install as | Purpose |
| --- | --- | --- |
| `vibelang-runtime` | Dependency | Small helpers used by compiled code |
| `effect`, `@effect/platform-node` | Dependency | Effect `^4.1.0` (tested on `4.1.6`) and Node platform |
| `vibelang` | Dev dependency | Compiler, language server, native binary, and VS Code extension |
| `vibelang-vite` | Dev dependency | Compiles `.vibe` modules for Vite and Vitest |
| `vitest`, `@effect/vitest` | Dev dependency | Vitest 5.1.0 and `@effect/vitest` `^4.1.0` |
| `vite` | Dev dependency | Vite 7 or 8 (explicit peer for Yarn) |

Keep `vibelang`, `vibelang-runtime`, and `vibelang-vite` at one version, keep `effect` and `@effect/platform-*` on stable `^4.1.0` releases, and keep optional dependencies enabled so `vibelang` installs its platform binary.

VibeLang uses TypeScript 7, which rejects removed options such as `moduleResolution: "node"` / `"node10"` and `baseUrl` (TS5108 / TS5102); see the [TypeScript 7 migration notes](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md).

## 3. Check the compiler

```sh
npx vibelang --version
```

```out
VibeLang 0.0.15 (TypeScript 7.1.0-dev)
```

## 4. Port Effect TypeScript files

Rename an Effect `.ts` file to `.vibe` (or `.tsx` to `.vibex`) and check it:

```sh
npx vibelang -p tsconfig.json --noEmit
```

- **TypeScript-style Effect code:** Library calls keep working in `.vibe` ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). A piped `Effect.gen(...)` also works. You can write the same program as an `effect function` with `provide` and `try`. For retired syntax from earlier releases, see [Migrating retired forms](migrating-retired-forms.md).
- **Relative imports and sidecars:** Replace stale `./user.ts` imports that point to a renamed `user.vibe` with `./user.vibe` or `./user.js` ([CLI setup](vibelang-cli.md)). `vibelang` writes adjacent `.d.vibe.ts` declarations even with `--noEmit` ([let TypeScript tools read .vibe modules](vibelang-cli.md#let-typescript-tools-read-vibe-modules)).
- **Monorepos & project references:** When migrating referenced packages, compile and revert steps refresh affected projects automatically. They follow the reverse reference closure, clear affected outputs, and rebuild reference roots before checking dependents. For native checking with Bun (`bun check --no-script`), route to `vibelang --noEmit` (or `vibelang -b` in build mode).

## Next

- **Coding agents:** run `npx vibelang agents init` ([Coding agents](coding-agents.md)).
- **Build setup:** [React](react.md), [Vue](vue.md), or [Svelte](svelte.md) with Vite; [Vite and Vitest](vite.md); [Build with the vibelang CLI](vibelang-cli.md) without a bundler; or step 3 of [Set up VibeLang](../setup.md) for other bundlers.
- **Last resort:** Only if you must keep TypeScript file names, consider the experimental [TypeScript shim](typescript-shim.md) after reading its stock-tool limitations.
