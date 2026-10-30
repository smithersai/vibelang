# Svelte and Vite

A Svelte 5 component renders a cart quote that a VibeLang program computes.
`src/cart.vibe` declares a `Product` schema, an `OutOfStock` error, and an
`Inventory` service with the `InventoryLive` layer. `quote` reserves a product
and recovers `OutOfStock` with `try`/`catch`. `quoteCart` runs two quotes
concurrently with `try.all`. `src/App.svelte` runs `quoteCart()` with a
`ManagedRuntime` built from `InventoryLive` and renders `Loading…` in an
`{#await}` block until the program completes.

## Run the app

Run `sh scripts/setup.sh` from the repository root first. It builds the
compiler and packs the runtime tarball that `package.json` installs. Then,
from this directory:

```sh
bun install
bun run dev
```

Open the URL that Vite prints. The page shows `Loading…`, then:

```text
Cart
2 x Green tea: $8.00
Only 1 coffee left
```

## Test the app

```sh
bun run test
```

The command stops at the first failure. It runs three steps:

1. `vibelang -p tsconfig.json --noEmit` type-checks `src/cart.vibe` and every
   `.ts` file as one program. It does not check `App.svelte`; see
   [Type checking `.svelte` files](#type-checking-svelte-files).
2. `vitest run` runs two files. `src/cart.test.vibe` checks `quote`, the
   `OutOfStock` failure, its recovery, and the cart with `@effect/vitest`.
   `src/App.test.ts` renders `App` in happy-dom with
   `@testing-library/svelte`, checks the loading text, and waits for both
   lines.
3. `vite build` writes the production bundle to `dist/`.

The output ends with:

```text
 Test Files  2 passed (2)
      Tests  5 passed (5)
...
✓ built in 224ms
```

## How the pieces connect

- `vite.config.ts` lists `vibelang()` from `vibelang-vite` before `svelte()`. The
  plugin compiles the project with the `vibelang` binary, and Vite serves each
  `.vibe` module as JavaScript. `svelteTesting()` from
  `@testing-library/svelte/vite` makes Vitest load Svelte's browser build and
  clean up after each test.
- `App.svelte` uses `<script lang="ts">` and imports `./cart.vibe` by its
  source name. `.ts` files import it the same way.
  `"rewriteRelativeImportExtensions": true` in `tsconfig.json` permits that
  import. Without it, the compiler reports TS5097.
- The `svelte` package declares `*.svelte` modules, so `vibelang` can check
  `main.ts` and `App.test.ts`, which import `App.svelte`.

## Type checking `.svelte` files

No type checker covers a `.svelte` file that imports a `.vibe` module.
`vibelang` does not read `.svelte` files. svelte-check reads them with
TypeScript 6, which cannot resolve `.vibe` modules. svelte-check 4.7.7
reports this for the component and for `runtime.ts`:

```text
src/runtime.ts:2:31
Error: Cannot find module './cart.vibe' or its corresponding type declarations.
src/App.svelte:3:29
Error: Cannot find module './cart.vibe' or its corresponding type declarations. (ts)
src/App.svelte:13:12
Error: Argument of type 'unknown' is not assignable to parameter of type 'ArrayLike<unknown> | Iterable<unknown> | null | undefined'. (ts)
```

The project therefore has no svelte-check step. `App.svelte` keeps its script
block thin: it imports `quoteCart` and runs one program. `cart.vibe`, its
tests, and the component test carry the checks.

## Coming from Effect

`quoteCart` in Effect TypeScript:

```ts
// TypeScript (.ts)
const quoteCart = Effect.fnUntraced(function* () {
  return yield* Effect.all([quote("tea", 2), quote("coffee", 3)], { concurrency: "unbounded" })
})
```
