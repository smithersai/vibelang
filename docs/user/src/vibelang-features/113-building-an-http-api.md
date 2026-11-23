# Building an HTTP API

Let's build a real JSON endpoint—`POST /users`—from scratch in four small files.

By the end, your API will:

1. Validate incoming JSON with a `schema`.
2. Return `201` for new users, `409` for duplicate names, and `400` for malformed payloads.
3. Run on a real Node HTTP server without importing `node:http`.
4. Run full end-to-end route tests in milliseconds without opening a single TCP socket.

Here is how the pieces stack together—portable handlers on top, abstract Effect services in the middle, and swappable host or test layers at the bottom:

![Platform and HTTP server layer stack](/diagrams/http-layer-stack.svg)

## Step 1: Model the contract and state (`users.vibe`)

Before touching HTTP, describe the domain cleanly: what a valid payload looks like (`schema`), what can go wrong (`error`), and what the user store can do (`service`).

```vibe
// users.vibe
// run: provide UsersLive { const users = try Users; { const jsonValue = try users.create("Ada"); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; const repeated = try result(users.create("Ada")); match (repeated) { when Result.Failure(let error): try Console.log(error.name); default: undefined; } }
export schema CreateUser { name: string }
export error NameTaken { name: string }

export service Users {
  create(name: string): { id: string; name: string }!NameTaken
}

export const UsersLive = Layer.effect(Users, effect {
  const names = new Set<string>()
  let nextId = 0
  return {
    effect create(name) {
      if (names.has(name)) throw new NameTaken({ name })
      names.add(name)
      nextId++
      return { id: String(nextId), name }
    }
  }
})
// Output: {"id":"1","name":"Ada"}
// Output: Ada
```

**Why build `UsersLive` with `Layer.effect` instead of module globals?**
Every time a server or test builds `UsersLive`, it gets a brand-new `Set` and counter. Two tests never leak users into each other, and `schema CreateUser` gives you both the static TypeScript type and a runtime JSON decoder in one line.

## Step 2: Decode requests and map failures (`routes.vibe`)

Now connect `Users` to `POST /users`. Read the JSON body through `HttpServerRequest.schemaBodyJson(CreateUser)`, call `users.create`, and translate every expected domain or schema failure into its HTTP status code:

```vibe
// routes.vibe
// run: try scoped(effect { const app = try HttpRouter.toHttpEffect(App); const statuses: number[] = []; for (const body of [{ name: "Ada" }, { name: "Ada" }, { name: 123 }]) { const client = try HttpClientRequest.bodyJson(HttpClientRequest.post("http://local/users"), body); const request = HttpServerRequest.fromClientRequest(client); statuses.push((try provideService(app, HttpServerRequest.HttpServerRequest, request)).status) }; try Console.log(try Effect.try(() => JSON.stringify(statuses))) })
import { CreateUser, NameTaken, Users, UsersLive } from "./users.vibe"

export effect function createUser() {
  return effect {
    const input = try HttpServerRequest.schemaBodyJson(CreateUser)
    const users = try Users
    const user = try users.create(input.name)
    return try HttpServerResponse.json(user, { status: 201 })
  } catch effect (error) => match (error) {
    when NameTaken: HttpServerResponse.text(`Name already registered: ${error.name}`, { status: 409 });
    when Schema.SchemaError: HttpServerResponse.text("Expected a JSON object with a string name", { status: 400 });
    default: throw error;
  }
}

export const Routes = HttpRouter.add("POST", "/users", createUser())
export const App = HttpRouter.provideRequest(UsersLive)(Routes)
// Output: [201,409,400]
```

Walk through what happens on three different requests:
- **`{ "name": "Ada" }` (first time)** -> Schema passes, `users.create("Ada")` succeeds -> `201 Created`.
- **`{ "name": "Ada" }` (second time)** -> `users.create` throws `NameTaken` -> `match` returns `409 Conflict`.
- **`{ "name": 123 }`** -> `schemaBodyJson` fails with `SchemaError` -> `match` returns `400 Bad Request`.
- **Anything unexpected** -> `default: throw error` forwards it to the HTTP boundary, and defects never enter `catch`, so a bug can never accidentally masquerade as a `200`.

Notice two subtle details that pay off later:
- `HttpRouter.add` takes `createUser()`—an **Effect value** that runs fresh on every request.
- `HttpRouter.provideRequest(UsersLive)(Routes)` attaches `UsersLive` directly to the router, so both the production server and in-memory tests share the exact same wiring.

## Step 3: Boot the server (`server.vibe` and `start.vibe`)

Because `.vibe` files never import `node:http` directly, `ExperimentalNodeHttpServer.layer({ port })` wraps Node's server behind a standard Effect layer. `HttpRouter.serve(App)` mounts your routes onto it, and `Layer.launch` keeps the server running until shutdown:

```vibe
// server.vibe
// run: provide Logger.layer([]) { try scoped(effect { try Layer.build(server(0)); try Console.log("server acquired") }); try Console.log("server released") }
import { ExperimentalNodeHttpServer } from "vibelang-runtime/experimental/platform-node"
import { App } from "./routes.vibe"

function server(port: number) {
  const Server = ExperimentalNodeHttpServer.layer({ port })
  return Layer.provide(HttpRouter.serve(App), Server)
}
const Live = server(3000)

export effect function main() {
  try Layer.launch(Live)
}
// Output: server acquired
// Output: server released
```

**Keep startup in its own tiny entry file.** `server.vibe` only *defines* `main()`; it opens no ports when imported. Put `NodeRuntime.runMain(main())` in `start.vibe`:

```vibe
// start.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { main } from "./server.vibe"

NodeRuntime.runMain(main())
```

Compile your project and run `node dist/start.js` to start listening on port `3000`—while tests can safely import `routes.vibe` or `server.vibe` without launching a server.

## Step 4: Test routes with zero sockets (`routes.test.vibe`)

Need to test `201`, `409`, and `400` in CI? You don't need to bind a port or juggle `fetch` timeouts. `HttpRouter.toHttpEffect(App)` turns your router into an ordinary Effect that reads `HttpServerRequest` from `R`:

```vibe
// routes.test.vibe
import { assert, it } from "@effect/vitest"
import { App } from "./routes.vibe"

effect function request(body: unknown) {
  const client = try HttpClientRequest.bodyJson(HttpClientRequest.post("http://local/users"), body)
  return HttpServerRequest.fromClientRequest(client)
}

it.live("validates bodies and rejects duplicate names", () => scoped(effect {
  const app = try HttpRouter.toHttpEffect(App)
  const statuses: number[] = []
  for (const body of [{ name: "Ada" }, { name: "Ada" }, { name: 123 }]) {
    provide HttpServerRequest.HttpServerRequest = try request(body) {
      statuses.push((try app).status)
    }
  }
  try Console.log(try Effect.try(() => JSON.stringify(statuses)))
  try Effect.try(() => assert.deepStrictEqual(statuses, [201, 409, 400]))
}))
// Output: [201,409,400]
```

Look closely at the test lifecycle:
- `scoped(effect { ... })` builds `UsersLive` once for the test and tears it down automatically at the end—so the three loop iterations share state (`201`, then `409`, then `400`), while the next test gets a clean slate.
- `it.live` uses the real `Console` so the logged status array prints (`it.effect` captures console output in a test console instead).
- Wrapping `assert.deepStrictEqual` in `Effect.try` turns a thrown assertion error into a clean test failure.

## Where to go next

Follow the [installation guide](../getting-started/004-installation.md) to configure the compiler and Vitest plugin, or clone the full runnable project—including Vite config—in [`examples/http-api`](https://github.com/smithersai/vibelang/tree/main/examples/http-api).
