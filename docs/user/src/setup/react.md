# React

Add VibeLang to a React app that builds with Vite. A component runs a VibeLang program with a `ManagedRuntime` and renders three states: loading, the result, and an error the program recovers from. Install the packages with [Add VibeLang to an existing project](existing-project.md) first. This page replaces [Vite and Vitest](vite.md): it covers the same plugin, tsconfig.json, Vitest, and build steps.

## 1. Install the test packages

With Bun, run:

```sh
bun add -d happy-dom@20.14.6 @testing-library/react@16.3.3 @testing-library/dom@10.4.2
```

With npm, run:

```sh
npm install --save-dev --save-exact happy-dom@20.14.6 @testing-library/react@16.3.3 @testing-library/dom@10.4.2
```

## 2. Configure tsconfig.json

Support for the new forms and adjacent `.d.vibe.ts` declarations arrives with the compiler's VIP implementation.

Find the configuration that includes `src`. In an app from Vite's `react-ts` template, `tsconfig.json` has `"files": []` and lists `tsconfig.app.json` and `tsconfig.node.json` as `references`; `tsconfig.app.json` includes `src`. Check that `include` selects the `.vibe` files. The template's `"include": ["src"]` does.

The VibeLang plugin's compile backend automatically enables `rewriteRelativeImportExtensions` for the JavaScript it emits. `vite build` therefore works with the template's `allowImportingTsExtensions` setting.

If you also emit JavaScript directly with the `vibelang` CLI, set `"rewriteRelativeImportExtensions": true` in that emitting project's `compilerOptions`. It permits source-extension imports and rewrites them to JavaScript paths; `allowImportingTsExtensions` alone produces TS5096 during CLI emission.

## 3. Configure Vite and Vitest

Replace `vite.config.ts` with this file, keeping any other plugins the app has. It adds `vibelang()` before `react()`, passes the configuration that includes `src` as `project`, and imports `defineConfig` from `vitest/config` so the same file configures Vitest. If `tsconfig.json` itself includes `src`, call `vibelang()` without `project`.

```ts
// TypeScript (.ts)
import react from "@vitejs/plugin-react"
import vibelang from "vibelang-vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vibelang({ project: "tsconfig.app.json" }), react()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.vibe", "src/**/*.test.tsx"]
  }
})
```

## 4. Add a VibeLang module

Create `src/users.vibe`. It declares a `Users` service and its layer; `greet` recovers from `UserNotFound`, so it cannot fail:

```vibe
// src/users.vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-7, VIP-9, VIP-12, VIP-13, VIP-14, VIP-15
// run: provide UsersLive { try Console.log(try greet("42")); try Console.log(try greet("404")); const users = try Users; try Console.log(users.find("404") catch (error) => `${error._tag} ${error.id}`) }
export schema User { id: string; name: string }

export error UserNotFound { id: string }

export service Users {
  find(id: string): User!UserNotFound
}

const directory: ReadonlyArray<User> = [
  { id: "42", name: "Ada Lovelace" },
  { id: "7", name: "Grace Hopper" }
]

export const UsersLive = Layer.succeed(Users, {
  effect find(id) {
    const user = directory.find((entry) => entry.id === id)
    if (user === undefined) throw new UserNotFound({ id })
    return user
  }
})

export effect greet(id: string) {
  const users = try Users
  return effect {
    const user = try users.find(id)
    return `Welcome, ${user.name}`
  } catch (error) => match (error) {
    when UserNotFound: `No user ${error.id}`
  }
}
```

```output
Welcome, Ada Lovelace
No user 404
UserNotFound 404
```

## 5. Run a program from a component

Create `src/runtime.ts`. One `ManagedRuntime` builds `UsersLive` once and runs every program in the app:

```ts
// TypeScript (.ts)
// src/runtime.ts
// run: return import("./users.vibe").then(({ greet }) => runtime.runPromise(greet("42"))).then(console.log).finally(() => runtime.dispose())
import { ManagedRuntime } from "effect"
import { UsersLive } from "./users.vibe"

export const runtime = ManagedRuntime.make(UsersLive)
```

```output
Welcome, Ada Lovelace
```

Create `src/Greeting.tsx`. To TypeScript, `greet(id)` returns `Effect<string, never, Users>`; `runtime.runPromise` provides `Users` and returns a `Promise<string>`. The `AbortSignal` interrupts the program when the component unmounts or `id` changes:

```tsx
// src/Greeting.tsx
import { useEffect, useState } from "react"
import { runtime } from "./runtime.ts"
import { greet } from "./users.vibe"

export function Greeting({ id }: { readonly id: string }) {
  const [text, setText] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    runtime.runPromise(greet(id), { signal: controller.signal }).then(setText, (cause) => {
      if (!controller.signal.aborted) throw cause
    })
    return () => controller.abort()
  }, [id])
  return <p>{text ?? "Loading…"}</p>
}
```

Render it from an existing component, such as `App` in `src/App.tsx`: add `import { Greeting } from "./Greeting.tsx"`, `<Greeting id="42" />`, and `<Greeting id="404" />`. The page shows `Loading…` twice, then `Welcome, Ada Lovelace` and `No user 404`.

## 6. Test the module and the component

Create `src/users.test.vibe`:

```vibe
// src/users.test.vibe
// pending: VIP-2, VIP-5, VIP-6, VIP-12, VIP-14
import { assert, it } from "@effect/vitest"
import { greet, UserNotFound, Users, UsersLive } from "./users.vibe"

it.effect("greets a known user", () => effect {
  const message = try Effect.provide(greet("42"), UsersLive)
  try sync(() => assert.strictEqual(message, "Welcome, Ada Lovelace"))
})

it.effect("fails a lookup with UserNotFound", () => effect {
  provide UsersLive {
    const users = try Users
    const outcome = try result(users.find("404"))
    try sync(() => {
      assert(Result.isFailure(outcome))
      if (Result.isFailure(outcome)) {
        assert.instanceOf(outcome.failure, UserNotFound)
        assert.strictEqual(outcome.failure.id, "404")
      }
    })
  }
})

it.effect("recovers UserNotFound in greet", () => effect {
  const message = try Effect.provide(greet("404"), UsersLive)
  try sync(() => assert.strictEqual(message, "No user 404"))
})
```

Create `src/Greeting.test.tsx`:

```tsx
// src/Greeting.test.tsx
import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { Greeting } from "./Greeting.tsx"

it("shows loading, then the user and the recovered error", async () => {
  render(<><Greeting id="42" /><Greeting id="404" /></>)
  expect(screen.getAllByText("Loading…")).toHaveLength(2)
  expect(await screen.findByText("Welcome, Ada Lovelace")).toBeDefined()
  expect(await screen.findByText("No user 404")).toBeDefined()
})
```

If `package.json` has no `test` script, add `"test": "vitest run"`. Run `npx vitest run`. The output includes:

```out
 Test Files  2 passed (2)
      Tests  4 passed (4)
```

## 7. Type-check and build

TypeScript cannot read `.vibe` files, so the template's `tsc -b` fails with TS2307: `Cannot find module './users.vibe'`. `vibelang -b` replaces it: it builds the same project references and checks `.vibe`, `.ts`, and `.tsx` files as one program. In `package.json`, change the `build` script:

```json
{
  "scripts": {
    "build": "vibelang -b && vite build"
  }
}
```

Run `npx vibelang -b`; it prints nothing and exits with status 0. Then run `npm run build` or `bun run build`; it exits with status 0, and its last line starts with `✓ built in`. Review the files you added and changed.

## Next

Set up the editor: [VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md). Then verify with step 4 of [Set up VibeLang](../setup.md).
