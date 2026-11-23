# Vue

Add VibeLang to a Vue + Vite app. A single-file component runs a VibeLang program through a `ManagedRuntime` and renders loading, success, and recovered-error states. Complete [Add VibeLang to an existing project](existing-project.md) first; this page replaces [Vite and Vitest](vite.md).

## 1. Install the test packages

With Bun:

```sh
bun add -d happy-dom@20.14.6 @vue/test-utils@2.5.1
```

With npm:

```sh
npm install --save-dev --save-exact happy-dom@20.14.6 @vue/test-utils@2.5.1
```

## 2. Configure tsconfig.json

Run `vibelang` to write adjacent `.d.vibe.ts` declarations (even with `--noEmit`) and [configure TypeScript tools to read them](vibelang-cli.md#let-typescript-tools-read-vibe-modules).

In Vite's `vue-ts` template, `tsconfig.json` references `tsconfig.app.json` (which covers `src`) and `tsconfig.node.json`. Make two changes in `tsconfig.app.json`:

1. The VibeLang plugin automatically enables `rewriteRelativeImportExtensions` for emitted JavaScript, so `vite build` works alongside `allowImportingTsExtensions`. For direct CLI emission with `vibelang -b` in step 8, set `"rewriteRelativeImportExtensions": true` in `compilerOptions` (`allowImportingTsExtensions` alone produces TS5096).
2. Add `"src/**/*.vibe"` to `include` so standalone `.vibe` files such as tests are included; without it, Vitest reports `vibelang: …/src/todos.test.vibe is not part of …/tsconfig.app.json. Add it to the tsconfig's include.`.

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue", "src/**/*.vibe"]
}
```

## 3. Declare .vue modules

`vibelang` does not read `.vue` files. Add `src/env.d.ts` so `vibelang -b` does not report `TS2307` on `.vue` imports such as `./App.vue`:

```ts
// TypeScript (.ts)
declare module "*.vue" {
  import type { DefineComponent } from "vue"
  const component: DefineComponent
  export default component
}
```

## 4. Configure Vite and Vitest

Update `vite.config.ts` (keeping existing plugins) to add `vibelang()` before `vue()`, pass `tsconfig.app.json` as `project` (omit if `tsconfig.json` directly includes `src`), and import `defineConfig` from `vitest/config`:

```ts
// TypeScript (.ts)
import vue from "@vitejs/plugin-vue"
import vibelang from "vibelang-vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vibelang({ project: "tsconfig.app.json" }), vue()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.vibe", "src/**/*.test.ts"]
  }
})
```

## 5. Add a VibeLang module

Create `src/todos.vibe`. The `TodosLive` layer keeps the list in a `Map` that its setup creates once, when the layer builds. `completeTodo` recovers from `TodoNotFound`, and `loadBoard` declares the contract `Board!!Todos`, so the compiler rejects any error escaping it:

```vibe
// src/todos.vibe
// run: provide TodosLive { { const jsonValue = try loadBoard(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const todos = try Todos; try Console.log(todos.complete(99) catch (error) => `${error._tag} ${error.id}`) }
export schema Todo { id: number; title: string; done: boolean }

export error TodoNotFound { id: number }

export service Todos {
  list(): ReadonlyArray<Todo>!!
  complete(id: number): Todo!TodoNotFound
}

export const TodosLive = Layer.effect(Todos, effect {
  const items = new Map<number, Todo>([
    [1, { id: 1, title: "Declare the schema", done: true }],
    [2, { id: 2, title: "Write the service", done: false }],
    [3, { id: 3, title: "Render the board", done: false }]
  ])
  return {
    effect list() { return [...items.values()] },
    effect complete(id) {
      const todo = items.get(id)
      if (todo === undefined) throw new TodoNotFound({ id })
      const done = { ...todo, done: true }
      items.set(id, done)
      return done
    }
  }
})

export effect function completeTodo(id: number) {
  const todos = try Todos
  return effect {
    const todo = try todos.complete(id)
    return `Completed: ${todo.title}`
  } catch (error) => match (error) {
    when TodoNotFound: `No todo #${error.id}`;
  }
}

export interface Board {
  todos: ReadonlyArray<Todo>
  messages: ReadonlyArray<string>
}

export effect function loadBoard(): Board!!Todos {
  const messages = [try completeTodo(2), try completeTodo(99)]
  const todos = try Todos
  return { todos: try todos.list(), messages }
}
```

```output
{"todos":[{"id":1,"title":"Declare the schema","done":true},{"id":2,"title":"Write the service","done":true},{"id":3,"title":"Render the board","done":false}],"messages":["Completed: Write the service","No todo #99"]}
TodoNotFound 99
```

## 6. Run a program from a component

Create `src/runtime.ts`. One `ManagedRuntime` builds `TodosLive` once and runs every program in the app:

```ts
// TypeScript (.ts)
// src/runtime.ts
// run: return import("./todos.vibe").then(({ completeTodo, loadBoard }) => runtime.runPromise(completeTodo(3)).then(() => runtime.runPromise(loadBoard()))).then((board) => console.log(JSON.stringify(board))).finally(() => runtime.dispose())
import { ManagedRuntime } from "effect"
import { TodosLive } from "./todos.vibe"

export const runtime = ManagedRuntime.make(TodosLive)
```

```output
{"todos":[{"id":1,"title":"Declare the schema","done":true},{"id":2,"title":"Write the service","done":true},{"id":3,"title":"Render the board","done":true}],"messages":["Completed: Write the service","No todo #99"]}
```

Create `src/TodoBoard.vue`. Its `<script setup lang="ts">` block imports `./todos.vibe` by its source name. `runtime.runPromise(loadBoard())` provides `Todos` and returns a `Promise<Board>`:

```vue
<script setup lang="ts">
import { onMounted, shallowRef } from "vue"
import { runtime } from "./runtime.ts"
import { loadBoard, type Board } from "./todos.vibe"

const board = shallowRef<Board>()
onMounted(async () => {
  board.value = await runtime.runPromise(loadBoard())
})
</script>

<template>
  <main>
    <h1>Todos</h1>
    <p v-if="board === undefined">Loading…</p>
    <template v-else>
      <ul>
        <li v-for="todo in board.todos" :key="todo.id">
          {{ todo.done ? "[x]" : "[ ]" }} {{ todo.title }}
        </li>
      </ul>
      <p v-for="message in board.messages" :key="message">{{ message }}</p>
    </template>
  </main>
</template>
```

Render it from an existing component, such as `src/App.vue`: add `import TodoBoard from "./TodoBoard.vue"` to its script block and `<TodoBoard />` to its template. The page shows `Loading…`, then the three todos, `Completed: Write the service`, and `No todo #99`.

## 7. Test the module and the component

Create `src/todos.test.vibe`:

```vibe
// src/todos.test.vibe
import { assert, it } from "@effect/vitest"
import { completeTodo, loadBoard, TodoNotFound, Todos, TodosLive } from "./todos.vibe"

it.effect("completes a todo", () => effect {
  provide TodosLive {
    const message = try completeTodo(2)
    try Effect.try(() => assert.strictEqual(message, "Completed: Write the service"))
  }
})

it.effect("fails with TodoNotFound for an unknown id", () => effect {
  provide TodosLive {
    const todos = try Todos
    const outcome = try result(todos.complete(99))
    try Effect.try(() => {
      assert(Result.isFailure(outcome))
      if (Result.isFailure(outcome)) {
        assert.instanceOf(outcome.failure, TodoNotFound)
        assert.strictEqual(outcome.failure.id, 99)
      }
    })
  }
})

it.effect("recovers TodoNotFound in completeTodo", () => effect {
  provide TodosLive {
    const message = try completeTodo(99)
    try Effect.try(() => assert.strictEqual(message, "No todo #99"))
  }
})

it.effect("loads the board after both completions", () => effect {
  provide TodosLive {
    const board = try loadBoard()
    try Effect.try(() => {
      assert.deepStrictEqual(board.messages, ["Completed: Write the service", "No todo #99"])
      assert.deepStrictEqual(board.todos.map((todo) => todo.done), [true, true, false])
    })
  }
})
```

Create `src/TodoBoard.test.ts`:

```ts
// TypeScript (.ts)
import { mount } from "@vue/test-utils"
import { expect, it, vi } from "vitest"
import TodoBoard from "./TodoBoard.vue"

it("shows loading, then the board and the recovered error", async () => {
  const wrapper = mount(TodoBoard)
  expect(wrapper.text()).toContain("Loading…")
  await vi.waitFor(() => expect(wrapper.text()).toContain("No todo #99"))
  expect(wrapper.findAll("li").map((item) => item.text())).toEqual([
    "[x] Declare the schema",
    "[x] Write the service",
    "[ ] Render the board"
  ])
  expect(wrapper.text()).toContain("Completed: Write the service")
})
```

If `package.json` has no `test` script, add `"test": "vitest run"`. Run `npx vitest run`. The output includes:

```out
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

## 8. Type-check and build

Run `vibelang` first to refresh adjacent `.d.vibe.ts` declarations (`vibelang` checks `.vibe` and `.ts`, not `.vue`), then run `vue-tsc` to check `.vue` scripts and templates against those declarations.

Create `tsconfig.check.json` for `vue-tsc`:

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

Disabling `rewriteRelativeImportExtensions` here avoids `TS2876` on `.vue` imports in `vue-tsc` 3.3.13 while keeping rewriting enabled in `tsconfig.app.json` for native emit.

Run both checks before Vite in `package.json`:

```json
{
  "scripts": {
    "build": "vibelang -b && vue-tsc --project tsconfig.check.json --noEmit && vite build"
  }
}
```

Run `npm run build` or `bun run build`. Refresh declarations whenever a `.vibe` module changes.

## Next

Configure your editor ([VS Code and Cursor](vscode.md), [Neovim](neovim.md), [Zed](zed.md), or [other editors](other-editors.md)), then verify with step 4 of [Set up VibeLang](../setup.md).
