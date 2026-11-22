# Add VibeLang to an existing project

Install VibeLang's packages in a project with a `package.json` and check that the compiler runs; then set up the build.

Call your own `.ts` functions and npm packages through `Effect.try` when they may throw, or `tryPromise` for Promises ([TypeScript boundaries](../vibelang-features/114-vibelang-for-effect-users.md#keep-platform-work-in-effect)). For example, import your parser and capture its input in the callback:

```ts
// TypeScript (.ts)
// settings.ts
export function parseSettings(text: string): unknown {
  return JSON.parse(text)
}
```

```vibe
// load-settings.vibe
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

Use Effect services for platform, clock and randomness APIs, such as `Console`, `Clock` and `Random`. The compiler reports unwrapped non-effectful foreign calls that may throw as `EK0403`, and platform calls, including the web's clock and randomness reads such as `crypto.randomUUID()`, as `EK4402` ([diagnostics](../getting-started/012-devtools.md#diagnostics-completions-and-refactors)). For non-effectful foreign calls, `@throws {never}` permits a direct call and a missing annotation means `unknown`. A written `@throws {RangeError}` or other non-`never` contract requires an `Effect.try` bridge in effect code (`EK0403`). A callable returning an `Effect`, `Stream` or `Layer` is effectful: call it directly, regardless of `@throws`. Run an Effect result with `try`; bridging its factory with `Effect.try` returns the cold program instead of its success value.

## 1. Check package.json

`package.json` must have `"type": "module"`. Before adding it, check how this changes Node's loading of your project's `.js` files.

The VibeLang runtime requires `effect` 4.1.1 exactly. The compiler declares the same exact peer dependency, so package managers can report an incompatible version during installation. The runtime depends on Effect internals and checks the exact version at load. VibeLang follows Effect 4.0.6's defect precedence, which 4.1.1 keeps: a failure whose cleanup crashes is a defect. Read the [release notes](../setup/release-notes.md) before updating code that inspects causes or recovers mixed failures. If your project depends on another `effect` version, review the migration before changing it. Upgrade an existing project to the pinned Effect version first, fix any failures, and verify its tests. Convert files to `.vibe` only after the Effect upgrade passes.

For a published library, keep `vibelang-runtime` in production dependencies at a registry version. If the package runs source in production through `vibelang/register` or `vibelang/bun`, also list `vibelang` in production dependencies. Check that those versions are available before publishing the library.

## 2. Install the packages

For npm, merge this transitive pin into the root `package.json`:

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.1.1"
  }
}
```

This keeps the platform package from selecting a newer patch with a different Effect peer requirement.

With Bun, keep using the active pin table in the root `package.json`. If `overrides` already exists, merge the helper pin there. If only `resolutions` exists, keep its other entries and add the pin to it:

```json
{
  "resolutions": {
    "@effect/platform-node-shared": "4.1.1"
  }
}
```

If neither table exists, use `overrides` as shown above. When both fields are present, [Bun uses only `overrides`](https://bun.com/docs/pm/overrides#resolutions). Adding `overrides` to a project that uses only `resolutions` would disable its existing pins.

Then run:

```sh
bun add --exact vibelang-runtime@0.0.13 effect@4.1.1 @effect/platform-node@4.1.1
bun add -d --exact vibelang@0.0.13 vibelang-vite@0.0.13 vitest@5.1.0 @effect/vitest@4.1.1
```

With npm, run:

```sh
npm install --save-exact vibelang-runtime@0.0.13 effect@4.1.1 @effect/platform-node@4.1.1
npm install --save-dev --save-exact vibelang@0.0.13 vibelang-vite@0.0.13 vitest@5.1.0 @effect/vitest@4.1.1
```

With pnpm, configure the [transitive pin](https://pnpm.io/settings/dependency-resolution#overrides) in `pnpm-workspace.yaml`. Also allow the install script of `dprint`, which `vibelang` depends on. pnpm 11 and later fail an install with `ERR_PNPM_IGNORED_BUILDS` when a dependency's build script is neither allowed nor denied. Merge these settings into `pnpm-workspace.yaml`:

```yaml
overrides:
  "@effect/platform-node-shared": "4.1.1"
allowBuilds:
  dprint: true
```

Then run:

```sh
pnpm add --save-exact vibelang-runtime@0.0.13 effect@4.1.1 @effect/platform-node@4.1.1
pnpm add --save-dev --save-exact vibelang@0.0.13 vibelang-vite@0.0.13 vitest@5.1.0 @effect/vitest@4.1.1
```

With Yarn, use the `node_modules` linker. Yarn Classic already uses it; for Yarn 2 and later, merge this into `.yarnrc.yml`:

```yaml
nodeLinker: node-modules
```

Put the transitive pin under [`resolutions`](https://yarnpkg.com/configuration/manifest#resolutions) in the root `package.json`; Yarn does not use npm's `overrides` setting:

```json
{
  "resolutions": {
    "@effect/platform-node-shared": "4.1.1"
  }
}
```

Then run:

```sh
yarn add --exact vibelang-runtime@0.0.13 effect@4.1.1 @effect/platform-node@4.1.1
yarn add --dev --exact vibelang@0.0.13 vibelang-vite@0.0.13 vitest@5.1.0 @effect/vitest@4.1.1
```

Yarn does not install peer dependencies automatically. Keep an existing Vite 7 or 8 dependency. If the project has neither, install the required `vite` peer before running Vite or Vitest:

```sh
yarn add --dev --exact vite@8
```


| Package | Install as | Purpose |
| --- | --- | --- |
| `vibelang-runtime` | Dependency | Small helpers used by compiled code |
| `effect`, `@effect/platform-node` | Dependency | Effect 4.1.1 and its Node platform |
| `vibelang` | Dev dependency | The compiler and language server, its native binary, and the VS Code extension |
| `vibelang-vite` | Dev dependency | Compiles `.vibe` modules for Vite and Vitest |
| `vitest`, `@effect/vitest` | Dev dependency | Vitest 5.1.0 and `@effect/vitest` 4.1.1 for tests |
| `vite` | Dev dependency | Vite 7 or 8, required by the Vite plugin and Vitest; Yarn projects provide this peer explicitly |

Keep `effect`, `@effect/platform-node`, and `@effect/vitest` at 4.1.1. `vibelang`, `vibelang-runtime`, and `vibelang-vite` release together; keep them at one version.

Keep optional dependencies enabled: `vibelang` gets its native compiler from one optional dependency per platform, such as `vibelang-darwin-arm64`. If an install skips them, as `npm install --omit=optional` does, `vibelang` cannot find its binary and exits with an error.

VibeLang uses TypeScript 7, which rejects removed options such as `moduleResolution: "node"` / `"node10"` and `baseUrl` (TS5108 / TS5102); update an older tsconfig using the [TypeScript 7 migration notes](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md).

## 3. Check the compiler

```sh
npx vibelang --version
```

The output is:

```out
VibeLang 0.0.13 (TypeScript 7.1.0-dev)
```

## 4. Port Effect TypeScript files

Rename a `.ts` file that uses Effect to `.vibe`, then check it:

```sh
npx vibelang -p tsconfig.json --noEmit
```

Update imports, re-exports, and build entry paths that name the old file. Keep any loader query or fragment. For example, change `"./counter.ts?raw#snippet"` to `"./counter.vibe?raw#snippet"` for a Vite raw import.

For ordinary source imports, update `./user.ts` to `./user.vibe` when the project permits source extensions, or use the runtime name `./user.js`. See [Stale TypeScript specifiers](migrating-retired-forms.md#stale-ts-specifiers).

Effect declarations and combinator calls written in TypeScript's style use the same library APIs in `.vibe` ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). An `Effect.gen` that the file pipes, such as `Effect.gen(...).pipe(Effect.provide(AppLive))`, reports `EK1002`: write its body by hand inside `export effect function main() { provide AppLive { ... } }`, reading a service as `try Users`.

Imports used by bare type references stay, and qualified types keep their qualification when shortening would expose a bare name. This preserves a shared module’s types when its consumers use different `lib` or `types` settings.

An `Effect.fn` parameter may retain its written type, such as `ReturnType<typeof make>`, when expanding it would import a generated declaration. Repeated builds keep that source type rather than treating a sidecar as an input.

Code written for an earlier VibeLang release can use forms that are now retired, such as a trailing block or a legacy platform entry marker. [Migrating retired forms](migrating-retired-forms.md) describes what to write instead.

Run `vibelang` to write adjacent `.d.vibe.ts` declarations, even with `--noEmit`; [configure TypeScript tools to read them](vibelang-cli.md#let-typescript-tools-read-vibe-modules).

Declaration identity checks follow namespace re-exports through native module bodies. This includes self-re-exports and cycles between module namespaces when a binding moves behind a named re-export. Forwarding an unchanged binding keeps its API; changed member types, export names and documentation still fail the check. Ordinary object values and declared mutable namespaces retain their mutability checks.

## Next

If you use a coding agent, run `npx vibelang agents init` to give it the VibeLang skill, the language server and a check after each edit ([Coding agents](coding-agents.md)).

Set up the build: [React](react.md), [Vue](vue.md), or [Svelte](svelte.md) with Vite; [Vite and Vitest](vite.md) for other Vite or Vitest projects; [Build with the vibelang CLI](vibelang-cli.md) without a bundler. For another bundler, see step 3 of [Set up VibeLang](../setup.md).

Only when the CLI and plugins above cannot fit a project that must keep TypeScript file names, consider the experimental [TypeScript shim](typescript-shim.md) as the last resort. Read its stock-tool limitations first.
