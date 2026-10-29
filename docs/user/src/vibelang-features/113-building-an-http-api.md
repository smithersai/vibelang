# Building an HTTP API

Build routes with Effect's HTTP modules and write each request handler as an effect function. This example creates users, validates JSON bodies, and maps expected failures to HTTP status codes.

## Define the body and the service

```vibe
// users.vibe
// pending: VIP-1, VIP-2, VIP-3, VIP-4, VIP-5, VIP-6, VIP-7, VIP-9, VIP-12, VIP-13, VIP-14, VIP-15
// run: provide UsersLive { const users = try Users; try Console.log(JSON.stringify(try users.create("Ada"))); const repeated = try result(users.create("Ada")); match (repeated) { when Result.Failure(let error): try Console.log(error.name); default: undefined } }
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

`schema CreateUser { name: string }` declares a struct schema and its type: it accepts a JSON object with a string `name`. The `create` member declares the expected failure `NameTaken`. The layer owns the name set and the ID counter, so each layer build starts with isolated state.

## Decode the request and map failures

```vibe
// routes.vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-7, VIP-14, VIP-33
// run: try scoped(effect { const app = try HttpRouter.toHttpEffect(App); const statuses: number[] = []; for (const body of [{ name: "Ada" }, { name: "Ada" }, { name: 123 }]) { const client = try HttpClientRequest.bodyJson(HttpClientRequest.post("http://local/users"), body); const request = HttpServerRequest.fromClientRequest(client); statuses.push((try provideService(app, HttpServerRequest.HttpServerRequest, request)).status) }; try Console.log(JSON.stringify(statuses)) })
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

`try HttpServerRequest.schemaBodyJson(CreateUser)` runs the JSON decoder and returns the validated body. A repeated name becomes 409, and a body that fails the schema 400. `default: throw error` passes any failure the `match` does not name on to the HTTP boundary.

`catch` sees expected failures only, not defects or interruption. Keep error-to-status mapping explicit so a programming defect cannot become a successful response.

`HttpRouter.add` receives `createUser()`, an Effect value that runs on each request. `HttpRouter.provideRequest` supplies `Users` to route execution, so `HttpRouter.toHttpEffect` in a test uses the same service implementation as the server.

## Start the Node server

Keep the Node.js import in a TypeScript companion file:

```ts
// node-server.ts
// types: node
export { createServer } from "node:http"
```

```vibe
// server.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide Logger.layer([]) { try scoped(effect { try Layer.build(server(0)); try Console.log("server acquired") }); try Console.log("server released") }
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import { createServer } from "./node-server.ts"
import { App } from "./routes.vibe"

function server(port: number) {
  const Server = NodeHttpServer.layer(createServer, { port })
  return Layer.provide(HttpRouter.serve(App), Server)
}
const Live = server(3000)

export effect function main() {
  try Layer.launch(Live)
}
// Output: server acquired
// Output: server released
```

A `.vibe` file imports no Node.js value directly, so the TypeScript companion file brings in Node's `createServer`. `NodeHttpServer.layer` runs it and owns its lifetime. `HttpRouter.serve` builds the serving layer, and `Layer.launch` keeps it alive until shutdown.

The module top level constructs schemas, routes, and layers. Start the application from a separate entry module:

```vibe
// start.vibe
// pending: VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { main } from "./server.vibe"

NodeRuntime.runMain(main())
```

`node start.js` starts the application by calling `NodeRuntime.runMain(main())`. Importing `server.js` from a test or another module starts nothing.

## Test a route without a socket

```vibe
// routes.test.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-33
import { assert, it } from "@effect/vitest"
import { App } from "./routes.vibe"

effect function request(body: unknown) {
  const client = try HttpClientRequest.bodyJson(HttpClientRequest.post("http://local/users"), body)
  return HttpServerRequest.fromClientRequest(client)
}

it.effect("validates bodies and rejects duplicate names", () => scoped(effect {
  const app = try HttpRouter.toHttpEffect(App)
  const created = try provideService(app, HttpServerRequest.HttpServerRequest, try request({ name: "Ada" }))
  const conflict = try provideService(app, HttpServerRequest.HttpServerRequest, try request({ name: "Ada" }))
  const bad = try provideService(app, HttpServerRequest.HttpServerRequest, try request({ name: 123 }))
  try sync(() => assert.deepStrictEqual([created.status, conflict.status, bad.status], [201, 409, 400]))
}))
// Output:
```

`try HttpRouter.toHttpEffect(App)` builds a request Effect without starting a server; hold it as `app`, then provide a request for each execution. The scope shares the service layer across these requests and releases it after the test; a new test scope builds a fresh user registry.

Import assertions from `@effect/vitest`; wrap assertions with `sync` so assertion exceptions become defects. The [installation guide](../getting-started/004-installation.md) sets up the compiler and test plugin. `examples/http-api` holds the complete project, including its Vite configuration.