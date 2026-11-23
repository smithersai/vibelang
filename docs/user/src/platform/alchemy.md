# Alchemy

[Alchemy](https://alchemy.run) declares cloud resources and Cloudflare Workers as Effect programs. This guide targets `alchemy` and `@alchemy.run/cloudflare` `2.0.0-beta.84`, `effect` `4.1.1`, and VibeLang `0.0.13`. Because Alchemy `2.0.0-beta.84` imports `effect/Crypto` (removed in Effect 4.1), apply the patch in [Install](#install) before importing `@alchemy.run/cloudflare`.

The complete notes API (an R2 bucket plus `PUT /key` and `GET /key` Worker) lives in [`examples/alchemy-stack`](https://github.com/smithersai/vibelang/tree/main/examples/alchemy-stack), where one Vitest suite verifies both the VibeLang and Effect TypeScript versions.

## Install

```sh
mkdir my-stack && cd my-stack
bun init -y
```

Pin `@effect/platform-node-shared` in `package.json` before installing:

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.1.1"
  }
}
```

```sh
bun add alchemy@2.0.0-beta.84 @alchemy.run/cloudflare@2.0.0-beta.84 effect@4.1.1 \
  @effect/platform-bun@4.1.1 @effect/platform-node@4.1.1 vibelang-runtime@0.0.13
bun add -d vibelang@0.0.13 vibelang-vite@0.0.13 vitest@5.1.0 @effect/vitest@4.1.1
```

Copy `patches/alchemy@2.0.0-beta.84.patch` (from [alchemy-run/alchemy#2754](https://github.com/alchemy-run/alchemy/pull/2754)) along with `tsconfig.json`, `vitest.config.ts`, and `bunfig.toml` from the example, then register the patch in `package.json` and run `bun install`:

```json
{
  "patchedDependencies": {
    "alchemy@2.0.0-beta.84": "patches/alchemy@2.0.0-beta.84.patch"
  }
}
```

`@effect/platform-bun` is a required peer dependency of the Alchemy CLI; `bunfig.toml` allows the pinned beta packages.

## Errors and matching

`error`, `throw`, and `catch` + `match` replace `Data.TaggedError`, `Effect.fail`, and `Effect.catchTags`:

```ts effect
import { Data, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

export class MissingNote extends Data.TaggedError("MissingNote")<{ readonly key: string }> {}

const notes = new Map<string, string>([["todo", "milk"]])

const read = (key: string) => {
  const note = notes.get(key)
  return note === undefined ? Effect.fail(new MissingNote({ key })) : Effect.succeed(note)
}

export const handle = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const key = new URL(request.url, "http://worker").pathname.slice(1)
  return HttpServerResponse.text(yield* read(key))
}).pipe(
  Effect.catchTags({
    MissingNote: (error) => Effect.succeed(HttpServerResponse.text(`No note at ${error.key}`, { status: 404 }))
  })
)
```

```vibe
export error MissingNote { key: string }

const notes = new Map<string, string>([["todo", "milk"]])

effect function read(key: string) {
  const note = notes.get(key)
  if (note === undefined) throw new MissingNote({ key })
  return note
}

export effect function handle() {
  const request = try HttpServerRequest.HttpServerRequest
  const url = try orDie(Effect.try(() => new URL(request.url, "http://worker")))
  const key = url.pathname.slice(1)
  return effect {
    return HttpServerResponse.text(try read(key))
  } catch (error) => match (error) {
    when MissingNote: HttpServerResponse.text(`No note at ${error.key}`, { status: 404 });
  }
}
```

## The Worker and its bucket

Hold top-level Alchemy resources as plain `const` Effect values, run binding operations with `try`, and wrap Worker initialization in `provide`:

```ts effect
// fragment
// api.ts
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Data, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

// An R2 bucket of notes, keyed by the request path.
export const Notes = Cloudflare.R2.Bucket("Notes", { forceDestroy: true })

export class MissingNote extends Data.TaggedError("MissingNote")<{ readonly key: string }> {}

// The Worker's init: binds the bucket, then returns the request handler.
export const makeApi = Effect.gen(function* () {
  const bucket = yield* Cloudflare.R2.ReadWriteBucket(Notes)

  const read = (key: string) =>
    Effect.gen(function* () {
      const note = yield* bucket.get(key)
      if (note === null) return yield* Effect.fail(new MissingNote({ key }))
      return yield* note.text()
    })

  return {
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const key = new URL(request.url, "http://worker").pathname.slice(1)
      if (request.method === "PUT") {
        yield* bucket.put(key, yield* request.text)
        return HttpServerResponse.empty({ status: 204 })
      }
      return HttpServerResponse.text(yield* read(key))
    }).pipe(
      Effect.catchTags({
        MissingNote: error => Effect.succeed(HttpServerResponse.text(`No note at ${error.key}`, { status: 404 })),
        R2Error: () => Effect.succeed(HttpServerResponse.text("Storage failed", { status: 502 }))
      })
    )
  }
})

export default Cloudflare.Worker(
  "Api",
  { main: import.meta.url },
  makeApi.pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding))
)
```

```vibe
// fragment
// api.vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-6, VIP-7, VIP-12, VIP-13, VIP-14, VIP-33
import * as Cloudflare from "@alchemy.run/cloudflare"

// An R2 bucket of notes, keyed by the request path. Alchemy declares a
// resource as an Effect; a .vibe module holds that value without running it.
export const Notes = Cloudflare.R2.Bucket("Notes", { forceDestroy: true })

export error MissingNote { key: string }

// Initialization binds the bucket and builds the request Effect.
export effect function makeApi() {
  const bucket = try Cloudflare.R2.ReadWriteBucket(Notes)

  effect function read(key: string) {
    const note = try bucket.get(key)
    if (note === null) throw new MissingNote({ key })
    return try note.text()
  }

  effect function handle() {
    const request = try HttpServerRequest.HttpServerRequest
    const url = try orDie(Effect.try(() => new URL(request.url, "http://worker")))
    const key = url.pathname.slice(1)
    return effect {
      if (request.method === "PUT") {
        try bucket.put(key, try request.text)
        return HttpServerResponse.empty({ status: 204 })
      }
      return HttpServerResponse.text(try read(key))
    } catch effect (error) => match (error) {
      when MissingNote: HttpServerResponse.text(`No note at ${error.key}`, { status: 404 });
      when { _tag: "R2Error" }: HttpServerResponse.text("Storage failed", { status: 502 });
      default: throw error;
    }
  }

  const api: Cloudflare.WorkerShape = { fetch: handle() }
  return api
}

export default Cloudflare.Worker("Api", { main: import.meta.url }, effect {
  provide Cloudflare.R2.ReadWriteBucketBinding {
    return try makeApi()
  }
})
```

Pass `{ fetch: handle() }` (an Effect value, not the function `{ fetch: handle }`, which fails with `TS2345`). Because `Cloudflare.Worker` restricts the handler error channel to `HttpBodyError | HttpServerError`, match both `MissingNote` and Alchemy's ambient `R2Error` (`when { _tag: "R2Error" }:`).

## The stack

```ts effect
// fragment
export default Alchemy.Stack(
  "NotesStack",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const api = yield* Api
    return { url: api.url }
  })
)
```

```vibe
// pending: VIP-2, VIP-5
// fragment
export default Alchemy.Stack(
  "NotesStack",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  effect {
    const api = try Api
    return { url: api.url }
  }
)
```

## Test without an account

Copy `src/`, `ts/`, and `test/` from the example, add the test script to `package.json`, and run it:

```json
{
  "scripts": {
    "test": "vibelang -p tsconfig.json --noEmit && vitest run"
  }
}
```

```sh
bun run test
```

```out
$ vibelang -p tsconfig.json --noEmit && vitest run

 ✓ test/api.test.ts (4 tests) 20ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

The test supplies an in-memory `Cloudflare.R2.ReadWriteBucket` binding and an empty Alchemy `Stack` service—no Cloudflare credentials or network required—and verifies `PUT /todo` (`204`), `GET /todo` (`milk`), and `GET /other` (`404`).

## Deploying

Direct deployment of `.vibe` sources via `alchemy deploy` is not supported yet because Alchemy loads `alchemy.run.ts` and bundles the Worker `main` without a VibeLang loader (and `alchemy plan` / `deploy` require a configured Cloudflare profile). Use the credential-free Vitest suite until deployment support lands.

## Migrating Alchemy code

See the [migration pairs](https://github.com/smithersai/vibelang/tree/main/examples/alchemy-stack/pairs) from Alchemy's `Telemetry.ts` and [Add VibeLang to an existing project](../setup/existing-project.md).
