# vibelang-typescript

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

An experimental implementation of [open VIP-42](https://github.com/smithersai/vibelang/blob/main/docs/design/vips/0042-vibelang-in-ts-files-open.md).

The package runs VibeLang's compiler under the name `typescript`. A project keeps its `.ts` files, its `tsc` scripts and its editor, and a `.ts` file whose first line is `// @vibe` compiles as VibeLang. Every other `.ts` file keeps TypeScript's verdict.

This package is the fallback. Prefer `.vibe` files with [the plugins](https://vibelang.sh/setup): they keep every stock TypeScript tool working, and this package does not.

Use the [installation instructions](https://vibelang.sh/setup/typescript-shim#install) to select the matching compiler and runtime versions, or try the [source-checkout preview](https://vibelang.sh/setup/typescript-shim#source-checkout-preview).

```ts
// @vibe
effect function greet(name: string) {
  return `hello ${name}`
}
```

The compiler is `vibelang`, TypeScript 7.1 with VibeLang. A tool that needs TypeScript's JavaScript API doesn't work with it. Bundlers parse `.ts` themselves, so they need `vibelang-vite` or `vibelang-unplugin`.

Read [VibeLang in .ts files](https://vibelang.sh/setup/typescript-shim) before installing the package.
