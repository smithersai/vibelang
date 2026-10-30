# Foldkit

[Foldkit](https://github.com/foldkit/foldkit) is a UI framework for Effect in the Elm architecture: a Model schema, Messages, an `update` function, Commands for side effects, and a `view`. Write the app in VibeLang; a TypeScript entry file mounts it with Foldkit's runtime. These pages use `foldkit` 0.169.0, `effect` 4.1.0 and VibeLang 0.0.11.

The complete app, a counter, a todo list and an HTTP command, is [`examples/foldkit-app`](https://github.com/smithersai/vibelang/tree/main/examples/foldkit-app). One Vitest suite runs against its VibeLang version and its Effect TypeScript original, so each pair below has the same tested behavior.

## Install

```sh
mkdir my-app && cd my-app
bun init -y
bun add effect@4.1.0 @effect/platform-browser@4.1.0 foldkit@0.169.0 vibelang-runtime@0.0.11
bun add -d vibelang@0.0.11 vibelang-vite@0.0.11 vite@8.3.4 vitest@5.0.5 happy-dom@20.14.6
```

`bun install` warns `incorrect peer dependency "effect@4.1.0"`: Foldkit 0.169.0 pins its `effect` and `@effect/platform-browser` peers to exactly 4.0.0. The example's tests and production build pass on 4.1.0.

## Configure

Copy `tsconfig.json`, `vite.config.ts`, `index.html`, `src/entry.ts` and `test/setup.ts` from the example. Foldkit's functions are plain TypeScript. Support for the new forms and adjacent `.d.vibe.ts` declarations arrives with the compiler's VIP implementation:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src", "test"]
}
```

Vitest needs `environment: "happy-dom"`, `server: { deps: { inline: ["foldkit"] } }` and Foldkit's `setup()` from `foldkit/test/vitest` in a setup file. The app's entry stays TypeScript and imports the `.vibe` module:

```ts
// TypeScript (.ts)
import { Runtime } from "foldkit"
import { Message, Model, init, update, view } from "./main.vibe"

Runtime.run(Runtime.makeApplication({ Model, init, update, view, container: document.getElementById("root"), devTools: { Message } }))
```

## The model

A `schema` declaration is the schema and its type at once; `Runtime.makeApplication({ Model })` takes it as the schema.

```ts effect
import { Schema } from "effect"

export const Todo = Schema.Struct({ id: Schema.Number, text: Schema.String, done: Schema.Boolean })
export type Todo = typeof Todo.Type

export const Model = Schema.Struct({
  count: Schema.Number,
  draft: Schema.String,
  todos: Schema.Array(Todo),
  quote: Schema.String
})
export type Model = typeof Model.Type
```

```vibe
// pending: VIP-15
export schema Todo { id: number; text: string; done: boolean }

export schema Model {
  count: number
  draft: string
  todos: ReadonlyArray<Todo>
  quote: string
}
```

## A command's work

An effect function runs each operation with `try`. A `catch` expression provides a fallback on typed failure.

```ts effect
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/http"

const Quote = Schema.Struct({ text: Schema.String })

export const quoteOrFallback = (url: string) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get(url)
    const quote = yield* Schema.decodeUnknownEffect(Quote)(yield* response.json)
    return quote.text
  }).pipe(Effect.catch(() => Effect.succeed("Could not load a quote")))
```

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-15, VIP-33
schema Quote { text: string }

effect function loadQuote(url: string) {
  const response = try HttpClient.get(url)
  const quote = try Schema.decodeUnknownEffect(Quote)(try response.json)
  return quote.text
}

export effect function quoteOrFallback(url: string) {
  return loadQuote(url) catch () => "Could not load a quote"
}
```

`response.json` holds an Effect value. Run it with `try response.json` to read the body, then run the Schema decoder with `try`.

In the app, the command returns a Message, and `provide` supplies Foldkit's HTTP layer inside it:

```ts effect
// fragment
export const FetchQuote = Command.define("FetchQuote", {
  args: {},
  messages: [Message.SucceededFetchQuote, Message.FailedFetchQuote],
  execute: () => Effect.provide(fetchQuote(), Http.layer)
})
```

```vibe
// pending: VIP-1, VIP-5, VIP-12
// fragment
export const FetchQuote = Command.define("FetchQuote", {
  args: {},
  messages: [Message.SucceededFetchQuote, Message.FailedFetchQuote],
  execute: effect () => {
    provide Http.layer {
      return try fetchQuote()
    }
  }
})
```

## update and view are plain functions

Foldkit's runtime calls `update` and `view` as plain functions. Declare them with `function` and leave off `effect`. A return annotation can check their result shape. It does not decide the function's kind.

```ts effect
// fragment
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedIncrement: () => ({ model: { ...model, count: model.count + 1 } }),
    ClickedFetchQuote: () => ({ model: { ...model, quote: "Loading..." }, commands: [FetchQuote({})] })
  })
```

```vibe
// fragment
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  return Message.match<Update.Return<Model, Message>>(message, {
    ClickedIncrement: () => ({ model: { ...model, count: model.count + 1 } }),
    ClickedFetchQuote: () => ({ model: { ...model, quote: "Loading..." }, commands: [FetchQuote({})] })
  })
}
```

`defineMessageUnion`, `Message.match`, `Command.define`, `Http.layer`, the `h` builder, and `story` tests are Foldkit's own API and read the same in both versions. The excerpts above trim the example's other messages.

## Test and build

```sh
bun run test
```

```out
$ vibelang -p tsconfig.json --noEmit && vitest run && vite build

 ✓ test/app.test.ts (10 tests) 20ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

`bun run dev` serves the app with Vite. The tests drive `update` with Foldkit's `story` helpers and run the HTTP command against an in-memory `HttpClient`, so no request leaves the process.

## Migrating Foldkit code

The [migration pairs](https://github.com/smithersai/vibelang/tree/main/examples/foldkit-app/pairs) are three files from VibeLang's migration of Foldkit itself, each of which passed Foldkit's 3,022 tests with identical public declarations. [Add VibeLang to an existing project](existing-project.md) covers porting an Effect file with `vibelang --fix`.
