# Svelte

Add VibeLang to a Svelte 5 app that builds with Vite. A component runs a VibeLang program with a `ManagedRuntime` and renders three states: loading, the result, and an error the program recovers from. Install the packages with [Add VibeLang to an existing project](existing-project.md) first. This page replaces [Vite and Vitest](vite.md): it covers the same plugin, tsconfig.json, Vitest, and build steps.

## 1. Install the test packages

With Bun, run:

```sh
bun add -d happy-dom@20.14.6 @testing-library/svelte@5.4.2
```

With npm, run:

```sh
npm install --save-dev --save-exact happy-dom@20.14.6 @testing-library/svelte@5.4.2
```

## 2. Configure tsconfig.json

Support for the new forms and adjacent `.d.vibe.ts` declarations arrives with the compiler's VIP implementation.

Find the configuration that includes `src`. In an app from Vite's `svelte-ts` template, `tsconfig.json` has `"files": []` and lists `tsconfig.app.json` and `tsconfig.node.json` as `references`; `tsconfig.app.json` includes `src`. Make two changes there:

1. The VibeLang plugin automatically enables `rewriteRelativeImportExtensions` for the JavaScript it emits, so `vite build` works without this setting. For the separate `vibelang -b` check in step 7, set `"rewriteRelativeImportExtensions": true` in `compilerOptions`; without it, a `.ts` file importing a `.vibe` module reports TS5097. It also rewrites source-extension imports during CLI emission; `allowImportingTsExtensions` alone produces TS5096 when emitting JavaScript.
2. Add `"src/**/*.vibe"` to `include`; the template lists only `.ts`, `.js`, and `.svelte` globs. Without the `.vibe` glob, the compiler skips `.vibe` files that no other file imports, such as tests, and Vitest reports `vibelang: …/src/cart.test.vibe is not part of …/tsconfig.app.json. Add it to the tsconfig's include.`.

```json
{
  "include": ["src/**/*.ts", "src/**/*.js", "src/**/*.svelte", "src/**/*.vibe"]
}
```

## 3. Configure Vite and Vitest

Replace `vite.config.ts` with this file, keeping any other plugins the app has. It adds `vibelang()` before `svelte()`, passes the configuration that includes `src` as `project`, and imports `defineConfig` from `vitest/config` so the same file configures Vitest. `svelteTesting()` makes Vitest load Svelte's browser build and clean up after each test. If `tsconfig.json` itself includes `src`, call `vibelang()` without `project`.

```ts
// TypeScript (.ts)
import { svelte } from "@sveltejs/vite-plugin-svelte"
import { svelteTesting } from "@testing-library/svelte/vite"
import vibelang from "vibelang-vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vibelang({ project: "tsconfig.app.json" }), svelte(), svelteTesting()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.vibe", "src/**/*.test.ts"]
  }
})
```

## 4. Add a VibeLang module

Create `src/cart.vibe`. `quote` reserves a product and recovers from `OutOfStock`, and `quoteCart` runs two quotes concurrently with `try.all`:

```vibe
// src/cart.vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-7, VIP-9, VIP-12, VIP-13, VIP-14, VIP-15, VIP-18
// run: provide InventoryLive { try Console.log((try quoteCart()).join("\n")); try Console.log(try quote("missing", 1)); const inventory = try Inventory; try Console.log(inventory.reserve("coffee", 3) catch (error) => `${error._tag} ${error.sku} ${error.available}`) }
export schema Product { sku: string; name: string; cents: number; stock: number }

export error OutOfStock { sku: string; available: number }

export service Inventory {
  reserve(sku: string, quantity: number): Product!OutOfStock
}

const catalog: ReadonlyArray<Product> = [
  { sku: "tea", name: "Green tea", cents: 400, stock: 5 },
  { sku: "coffee", name: "Coffee beans", cents: 1200, stock: 1 }
]

export const InventoryLive = Layer.succeed(Inventory, {
  effect reserve(sku, quantity) {
    const product = catalog.find((entry) => entry.sku === sku)
    const available = product?.stock ?? 0
    if (product === undefined || available < quantity) throw new OutOfStock({ sku, available })
    return product
  }
})

export effect function quote(sku: string, quantity: number) {
  const inventory = try Inventory
  return effect {
    const product = try inventory.reserve(sku, quantity)
    const total = (product.cents * quantity / 100).toFixed(2)
    return `${quantity} x ${product.name}: $${total}`
  } catch (error) => match (error) {
    when OutOfStock: `Only ${error.available} ${error.sku} left`;
  }
}

export effect function quoteCart() {
  return try.all [quote("tea", 2), quote("coffee", 3)]
}
```

```output
2 x Green tea: $8.00
Only 1 coffee left
Only 0 missing left
OutOfStock coffee 1
```

## 5. Run a program from a component

Create `src/runtime.ts`. One `ManagedRuntime` builds `InventoryLive` once and runs every program in the app:

```ts
// TypeScript (.ts)
// src/runtime.ts
// run: return import("./cart.vibe").then(({ quoteCart }) => runtime.runPromise(quoteCart())).then((lines) => console.log(lines.join("\n"))).finally(() => runtime.dispose())
import { ManagedRuntime } from "effect"
import { InventoryLive } from "./cart.vibe"

export const runtime = ManagedRuntime.make(InventoryLive)
```

```output
2 x Green tea: $8.00
Only 1 coffee left
```

Create `src/CartQuote.svelte`. Its `<script lang="ts">` block imports `./cart.vibe` by its source name. `runtime.runPromise(quoteCart())` provides `Inventory` and returns a `Promise`, which the `{#await}` block renders:

```svelte
<script lang="ts">
  import { runtime } from "./runtime.ts"
  import { quoteCart } from "./cart.vibe"

  const quotes = runtime.runPromise(quoteCart())
</script>

<main>
  <h1>Cart</h1>
  {#await quotes}
    <p>Loading…</p>
  {:then lines}
    {#each lines as line (line)}
      <p>{line}</p>
    {/each}
  {/await}
</main>
```

Render it from an existing component, such as `src/App.svelte`: add `import CartQuote from "./CartQuote.svelte"` to its script block and `<CartQuote />` to its markup. The page shows `Loading…`, then `2 x Green tea: $8.00` and `Only 1 coffee left`.

## 6. Test the module and the component

Create `src/cart.test.vibe`:

```vibe
// src/cart.test.vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-12, VIP-14
import { assert, it } from "@effect/vitest"
import { InventoryLive, Inventory, OutOfStock, quote, quoteCart } from "./cart.vibe"

it.effect("quotes a product in stock", () => effect {
  const line = try Effect.provide(quote("tea", 2), InventoryLive)
  try Effect.try(() => assert.strictEqual(line, "2 x Green tea: $8.00"))
})

it.effect("fails a reservation with OutOfStock", () => effect {
  provide InventoryLive {
    const inventory = try Inventory
    const outcome = try result(inventory.reserve("coffee", 3))
    try Effect.try(() => {
      assert(Result.isFailure(outcome))
      if (Result.isFailure(outcome)) {
        assert.instanceOf(outcome.failure, OutOfStock)
        assert.strictEqual(outcome.failure.available, 1)
      }
    })
  }
})

it.effect("recovers OutOfStock in quote", () => effect {
  const line = try Effect.provide(quote("coffee", 3), InventoryLive)
  try Effect.try(() => assert.strictEqual(line, "Only 1 coffee left"))
})

it.effect("quotes the cart concurrently", () => effect {
  const lines = try Effect.provide(quoteCart(), InventoryLive)
  try Effect.try(() => assert.deepStrictEqual(lines, ["2 x Green tea: $8.00", "Only 1 coffee left"]))
})
```

Create `src/CartQuote.test.ts`:

```ts
// TypeScript (.ts)
import { render, screen } from "@testing-library/svelte"
import { expect, it } from "vitest"
import CartQuote from "./CartQuote.svelte"

it("shows loading, then the quote and the recovered error", async () => {
  render(CartQuote)
  expect(screen.getByText("Loading…")).toBeDefined()
  expect(await screen.findByText("2 x Green tea: $8.00")).toBeDefined()
  expect(await screen.findByText("Only 1 coffee left")).toBeDefined()
})
```

If `package.json` has no `test` script, add `"test": "vitest run"`. Run `npx vitest run`. The output includes:

```out
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

## 7. Type-check and build

svelte-check does not understand `.vibe` files, so the template's `check` script fails: svelte-check 4.7.7 reports TS2307 for each import of `./cart.vibe`, then TS2345 for the `{#each}` block, whose `lines` it types as `unknown`. With `--output human` it prints absolute paths, shortened here to `src/`:

```out
src/runtime.ts:4:31
Error: Cannot find module './cart.vibe' or its corresponding type declarations.

src/CartQuote.svelte:3:29
Error: Cannot find module './cart.vibe' or its corresponding type declarations. (ts)
```

Use `vibelang -b` instead: it builds the same project references and checks `.vibe` and `.ts` files as one program, but not the script blocks of `.svelte` files. Keep those blocks thin: import a program, run it, and render its result, as `CartQuote.svelte` does. The `.vibe` tests and the component test cover the rest. In `package.json`, change the `check` script:


```json
{
  "scripts": {
    "check": "vibelang -b"
  }
}
```

Run `npm run check` or `bun run check`; it exits with status 0. Then run `npm run build` or `bun run build`; it exits with status 0, and its last line starts with `✓ built in`. Review the files you added and changed. Your `check` script now uses VibeLang instead of `svelte-check`.

## Next

Set up the editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).
