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

After the supported CLI, plugins and editor routes, the experimental [TypeScript shim](typescript-shim.md) is a last resort for projects that cannot change TypeScript file names. It is included in the VibeLang 0.0.13 release under open VIP-42. Stock readers can accept a marked file with different meaning.

Mapper failures `EK9001` through `EK9006` have [repair guidance in the diagnostic reference](../vibelang-features/diagnostic-code-map.md#typescript-mapper-failures).
