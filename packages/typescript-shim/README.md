# vibelang-typescript

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

A source-checkout preview, not published to npm, implementing [VIP-42](https://github.com/smithersai/vibelang/blob/main/docs/design/vips/0042-vibelang-in-ts-files-open.md).

The package runs VibeLang's compiler under the name `typescript`. A project keeps its `.ts` files, its `tsc` scripts and its editor, and a `.ts` file whose first line is `// @vibe` compiles as VibeLang. Every other `.ts` file keeps TypeScript's verdict.

This package is the fallback. Prefer `.vibe` files with [the plugins](https://vibelang.sh/setup): they keep every stock TypeScript tool working, and this package does not.

Use the [source-checkout preview](https://vibelang.sh/setup/typescript-shim#source-checkout-preview) to try the compiler. The replacement package is not currently available from npm.

```ts
// @vibe
effect function greet(name: string) {
  return `hello ${name}`
}
```

The compiler is `vibelang`, TypeScript 7.1 with VibeLang. A tool that needs TypeScript's JavaScript API doesn't work with it. Bundlers parse `.ts` themselves, so they need `vibelang-vite` or `vibelang-unplugin`.

Read [VibeLang in .ts files](https://vibelang.sh/setup/typescript-shim) before installing the package.

Editor formatting uses the formatter shipped with the installed `vibelang` package, including when the native executable is in a separate platform package. No formatter environment settings are needed.

### Installing a preview tarball

With the matching `vibelang@0.0.13` compiler available in your registry, pack
this directory with `npm pack`. From the consuming project, use the absolute
tarball path as the value of the project's TypeScript dev dependency.

```json
{ "devDependencies": { "typescript": "file:/absolute/path/vibelang-typescript-7.1.13.tgz" } }
```

Run `npm install`, `pnpm install`, `yarn install`, or `bun install` to update
the project's lockfile.

### Tools that load the compiler API

The root module supplies typed `version` and `versionMajorMinor` exports.
Run `sh packages/typescript-shim/test/check-tool-compatibility.sh` from
the checkout to exercise the following tools with the packed shim. The
check needs npm registry access and exits nonzero if any tool fails.

| Tool and mode | Result on the mixed project |
| --- | --- |
| tsup 9.0.0 with `--dts` | esbuild has no loader for the imported `.vibe` file. |
| tsdown 0.23.7 with `--dts` | The default declaration generator requires the classic TypeScript API. |
| ts-loader 9.6.2 | Loader setup fails reading `sys.fileExists`. |
| fork-ts-checker-webpack-plugin 9.2.0 | The checker cannot call `readConfigFile`. Webpack also needs a loader for `.vibe`. |
| typescript-eslint 8.74.0, type-aware rule | The plugin rejects the TypeScript 7 API during startup. |
| TypeDoc 0.28.20 | Startup fails reading `SyntaxKind.PropertyDeclaration`. |
| vue-tsc 3.3.14 | Needs the classic TypeScript JavaScript compiler API beyond the `typescript/lib/tsc` binary entry. |
| svelte-check 4.7.8 | The default mode rejects a sole TypeScript 7 installation and requests a TypeScript 6 companion for its TS7 modes. |
| Knip 6, unresolved imports | The configured scan exits 0. This checks import resolution only. |
| ts-jest 29.4.15 | Its transformer rejects the missing classic JavaScript compiler API before executing the test. |

Legacy tsserver hosts speak the tsserver protocol. The shim serves LSP
through `tsc --lsp --stdio`.

The native TypeScript 7 client entry points, including `typescript/sync` and
`typescript/async`, also need a client matched to VibeLang's native server.
