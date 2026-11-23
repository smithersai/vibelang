# Svelte

Add VibeLang to a Svelte 5 + Vite app. A component runs a VibeLang program through a `ManagedRuntime` and renders loading, success, and recovered-error states. Complete [Add VibeLang to an existing project](existing-project.md) first; this page replaces [Vite and Vitest](vite.md).

## 1. Install the test packages

With Bun:

```sh
bun add -d happy-dom@20.14.6 @testing-library/svelte@5.4.2
```

With npm:

```sh
npm install --save-dev --save-exact happy-dom@20.14.6 @testing-library/svelte@5.4.2
```

## 2. Configure tsconfig.json

Run `vibelang` to write adjacent `.d.vibe.ts` declarations (even with `--noEmit`) and [configure TypeScript tools to read them](vibelang-cli.md#let-typescript-tools-read-vibe-modules).

In Vite's `svelte-ts` template, `tsconfig.json` references `tsconfig.app.json` (which covers `src`) and `tsconfig.node.json`. Make two changes in `tsconfig.app.json`:

1. The VibeLang plugin automatically enables `rewriteRelativeImportExtensions` for emitted JavaScript, so `vite build` works without it. For `vibelang -b` in step 7, set `"rewriteRelativeImportExtensions": true` in `compilerOptions`; without it, `vibelang -b` reports TS5097 on `.ts` files importing `.vibe` (and `allowImportingTsExtensions` alone produces TS5096 on CLI emit).
2. Add `"src/**/*.vibe"` to `include` so standalone `.vibe` files such as tests are included; without it, Vitest reports `vibelang: …/src/cart.test.vibe is not part of …/tsconfig.app.json. Add it to the tsconfig's include.`.

```json
{
  "include": ["src/**/*.ts", "src/**/*.js", "src/**/*.svelte", "src/**/*.vibe"]
}
```

## 3. Configure Vite and Vitest

Update `vite.config.ts` (keeping existing plugins) to add `vibelang()` before `svelte()` and `svelteTesting()` (which loads Svelte's browser build and cleans up between tests), pass `tsconfig.app.json` as `project` (omit if `tsconfig.json` directly includes `src`), and import `defineConfig` from `vitest/config`:

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
    const total = try orDie(Effect.try(() => (product.cents * quantity / 100).toFixed(2)))
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
import { assert, it } from "@effect/vitest"
import { InventoryLive, Inventory, OutOfStock, quote, quoteCart } from "./cart.vibe"

it.effect("quotes a product in stock", () => effect {
  provide InventoryLive {
    const line = try quote("tea", 2)
    try Effect.try(() => assert.strictEqual(line, "2 x Green tea: $8.00"))
  }
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
  provide InventoryLive {
    const line = try quote("coffee", 3)
    try Effect.try(() => assert.strictEqual(line, "Only 1 coffee left"))
  }
})

it.effect("quotes the cart concurrently", () => effect {
  provide InventoryLive {
    const lines = try quoteCart()
    try Effect.try(() => assert.deepStrictEqual(lines, ["2 x Green tea: $8.00", "Only 1 coffee left"]))
  }
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

Run `vibelang` first to refresh adjacent `.d.vibe.ts` declarations (`vibelang` checks `.vibe` and `.ts`, not `.svelte`), then run `svelte-check` to type-check `.svelte` scripts and templates against those declarations.

Create `tsconfig.check.json` for `svelte-check`:

```json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "noEmit": true,
    "allowArbitraryExtensions": true,
    "rewriteRelativeImportExtensions": false
  }
}
```

`allowArbitraryExtensions` resolves `./cart.vibe` through `cart.d.vibe.ts` (avoiding `TS2307`). Keep import rewriting enabled in `tsconfig.app.json` for native emit.

Run both checkers in `package.json`:

```json
{
  "scripts": {
    "check": "vibelang -b && svelte-check --tsconfig tsconfig.check.json"
  }
}
```

Run `npm run check` or `bun run check`, and `npm run build` or `bun run build`. Refresh declarations whenever a `.vibe` module changes.

## Next

Configure your editor ([VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md)), then verify with step 4 of [Set up VibeLang](../setup.md).
