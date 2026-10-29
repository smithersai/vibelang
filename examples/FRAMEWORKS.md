# Foldkit and Alchemy with VibeLang

Two checked example projects pair VibeLang with its Effect TypeScript
original: [foldkit-app](foldkit-app/) and [alchemy-stack](alchemy-stack/).
This file is the hand-off for `docs/user/src/setup/foldkit.md` and
`docs/user/src/platform/alchemy.md`. Every command and output below ran on
2026-10-28 against this checkout's compiler.

```
example         framework                       VibeLang   Effect TS   tests        build
--------------  ------------------------------  ---------  ----------  -----------  -----------
foldkit-app     foldkit 0.169.0                 src/       ts/         10 (5 + 5)   vite build
alchemy-stack   alchemy 2.0.0-beta.84 (Worker)  src/       ts/         4 (2 + 2)    no deploy
```

One Vitest suite per project runs against both versions, so the panes show
code with the same tested behavior.

## Common facts

- Effect 4.1.0 and VibeLang 0.0.11 in both. npm's latest VibeLang is 0.0.10;
  every example in this repository pins 0.0.11, so until it is published the
  projects check only through `scripts/check-examples.sh` (or
  `sh scripts/setup.sh` and `file:` links), not with `bun install` from npm.
- The repository check: `sh scripts/setup.sh`, then
  `sh scripts/check-examples.sh`. It stages copies with this checkout's
  compiler, runtime and Vite plugin and runs each project's `bun run test`.
  Its last lines on this change:

  ```
  OK   foldkit-app bun run test over both versions
  OK   alchemy-stack bun run test over both versions
  ```
- Neither framework is in `docs/tools/node_modules`, so the docs harness
  cannot resolve `foldkit` or `@alchemy.run/*` (see the snippet table in each
  section).
- The alchemy-stack VibeLang Stack needs the compiler fix that lands just
  before these examples: calling an Alchemy Worker, an
  `Effect<Worker> & Named<...>`, was `TS2349`.

## Foldkit

### Verified files

| File | What it is |
| --- | --- |
| `foldkit-app/src/main.vibe` | Model, messages, the `FetchQuote` command, `update`, `init`, `view` |
| `foldkit-app/ts/main.ts` | The Effect TypeScript original |
| `foldkit-app/src/entry.ts` | Mounts the VibeLang app with `Runtime.makeApplication` |
| `foldkit-app/test/app.test.ts` | `story` tests of `update` and the HTTP command, run against both |
| `foldkit-app/tsconfig.json` | `"vibelang": { "trustedPackages": ["foldkit"] }` |
| `foldkit-app/vite.config.ts` | `vibelang-vite`, happy-dom, `server.deps.inline: ["foldkit"]` |
| `foldkit-app/pairs/README.md` | Three real pairs from the Foldkit migration |

Versions: `foldkit` 0.169.0 (the version the Foldkit migration used, published
2026-10-21), `effect` and `@effect/platform-browser` 4.1.0, `vite` 8.3.4,
`vitest` 5.0.5, `happy-dom` 20.14.6.

### Commands and output

```sh
cd examples/foldkit-app
bun install
bun run test
```

```
$ vibelang -p tsconfig.json --noEmit && vitest run && vite build

 ✓ test/app.test.ts (10 tests) 20ms

 Test Files  1 passed (1)
      Tests  10 passed (10)

vite v8.3.4 building client environment for production...
✓ 487 modules transformed.
dist/index.html                  0.33 kB │ gzip:   0.24 kB
dist/assets/index-BEydSQBy.js  331.73 kB │ gzip: 109.74 kB
✓ built in 2.71s
```

`bun install` warns `incorrect peer dependency "effect@4.1.0"` and
`"@effect/platform-browser@4.1.0"`: Foldkit 0.169.0 pins both peers to
exactly 4.0.0. The suite and the build pass on 4.1.0.

### Setup from an empty project

```sh
mkdir my-app && cd my-app
bun init -y
bun add effect@4.1.0 @effect/platform-browser@4.1.0 foldkit@0.169.0 vibelang-runtime@0.0.11
bun add -d vibelang@0.0.11 vibelang-vite@0.0.11 vite@8.3.4 vitest@5.0.5 happy-dom@20.14.6
```

Then copy from `foldkit-app/`: `tsconfig.json` (Bundler resolution, DOM
libs, `trustedPackages`), `vite.config.ts`, `index.html`, `src/entry.ts`
and `test/setup.ts` (`setup()` from `foldkit/test/vitest`). Write the app in
`src/main.vibe`. `bun run dev` serves it; `bun run test` checks, tests and
builds.

### Forms to teach

1. **`schema` for the Model.** `schema Todo { id: number; text: string; done: boolean }`
   replaces `Schema.Struct({...})` plus `type Todo = typeof Todo.Type`;
   `Runtime.makeApplication({ Model })` takes the declaration as the schema.
2. **A command body as direct calls, with a `catch` fallback.** `loadQuote()`
   calls `HttpClient.get` and `Schema.decodeUnknownEffect(Quote)(response.json())`
   in order; `loadQuote() catch Message.FailedFetchQuote({...})` replaces
   `Effect.gen` plus `Effect.catch(() => Effect.succeed(...))`.
3. **`provide` inside the command.** `execute: () => { provide Http.layer { return fetchQuote() } }`
   replaces `Effect.provide(fetchQuote(), Http.layer)`.
4. **Plain `update` and `view`.** They declare return types
   (`Update.Return<Model, Message>`, `Document`), so they compile to plain
   functions, as Foldkit's runtime calls them.

Framework specifics: `defineMessageUnion`, `Message.match`, `Command.define`,
`Http.layer`, the `h` builder, and `story`/`Command.resolve` tests are
Foldkit's own API and read the same in both panes.

### Sharp edges

- **`trustedPackages`.** Foldkit's functions are plain TypeScript. Without
  `"trustedPackages": ["foldkit"]`, each call inside a `.vibe` function, such
  as `Message.match(...)` in `update`, is `EK4401`.
- **`update` needs its return type.** Unannotated, `update` became
  Effect-returning, and `Runtime.makeApplication` rejected it with `TS2769`
  (`Property 'model' is missing in type 'Effect<...>'`).
- **`response.json` is a property holding an Effect.** VibeLang reads it as
  data; `response.json()` runs it. Without the parentheses the code compiles
  and the decode fails at run time on an Effect object, so the command
  reported `FailedFetchQuote` with a valid response. The shared test caught
  it; no diagnostic does.
- **Vitest config.** Foldkit needs `environment: "happy-dom"`,
  `server.deps.inline: ["foldkit"]` and `setup()` from `foldkit/test/vitest`.
- **Peer pins.** See the install warning above.

### Which snippets compile in the docs harness

Probed with `bun docs/tools/check-snippets.ts --root <probe>`:

| Snippet | Harness result |
| --- | --- |
| The Model as `schema` declarations | `ok` |
| The command body using only `effect/http` (`loadQuote` with a string fallback) | `ok` |
| Anything importing `foldkit` (`defineMessageUnion`, `Command.define`, `update`, `view`) | `fail`: `TS2307 Cannot find module 'foldkit'`, then `EK3207` on `provide Http.layer` |
| The same with `// fragment` as its first line | `fragment` |

So: mark Foldkit panes (VibeLang and TypeScript) `// fragment` and link to
`examples/foldkit-app`, which `scripts/check-examples.sh` compiles and tests.
Framework-free excerpts can stay checked.

## Alchemy

### Verified files

| File | What it is |
| --- | --- |
| `alchemy-stack/src/api.vibe` | The `Notes` R2 bucket, the `MissingNote` error, `makeApi`, and the Worker |
| `alchemy-stack/src/stack.vibe` | The `NotesStack` stack that deploys the Worker |
| `alchemy-stack/ts/api.ts`, `ts/stack.ts` | The Effect TypeScript original |
| `alchemy-stack/test/api.test.ts` | Runs the Worker's init and handler against an in-memory bucket, for both |
| `alchemy-stack/bunfig.toml` | Release-age exclusions for the exact Alchemy pins |
| `alchemy-stack/pairs/README.md` | Two real pairs from the Alchemy migration |

Versions: `alchemy` and `@alchemy.run/cloudflare` 2.0.0-beta.84 (npm
`latest`, the version the Alchemy migration used, published 2026-10-24); `effect`,
`@effect/platform-bun`, `@effect/platform-node` and `@effect/vitest` 4.1.0;
`vitest` 5.0.5.

### Commands and output

```sh
cd examples/alchemy-stack
bun install
bun run test
```

```
$ vibelang -p tsconfig.json --noEmit && vitest run

 ✓ test/api.test.ts (4 tests) 20ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

No credentials, account or network: the test provides
`Cloudflare.R2.ReadWriteBucket` with a `Map`-backed client and an empty
Alchemy `Stack` service, then sends `PUT /todo`, `GET /todo` and
`GET /other` through `HttpServerRequest.fromClientRequest`, expecting 204,
200 `milk` and 404 `No note at other`.

### Setup from an empty project

```sh
mkdir my-stack && cd my-stack
bun init -y
bun add alchemy@2.0.0-beta.84 @alchemy.run/cloudflare@2.0.0-beta.84 effect@4.1.0 \
  @effect/platform-bun@4.1.0 @effect/platform-node@4.1.0 vibelang-runtime@0.0.11
bun add -d vibelang@0.0.11 vibelang-vite@0.0.11 vitest@5.0.5 @effect/vitest@4.1.0
```

Copy `tsconfig.json`, `vitest.config.ts` and `bunfig.toml` from
`alchemy-stack/`. The Alchemy CLI refuses to start without
`@effect/platform-bun` ("Alchemy could not load the required peer
dependency"). Until 2026-10-31, beta.84 and its exactly pinned
`@alchemy.run/*` and `@distilled.cloud/*` 1.0.0-rc.17 packages are younger
than the repository's seven-day `minimumReleaseAge`, so `bunfig.toml`
excludes them by name.

### Forms to teach

1. **`error` and `throw`, then `match`.** `error MissingNote { key: string }`
   and `throw new MissingNote({ key })` replace `Data.TaggedError` and
   `Effect.fail`; `try { } catch (error) { return match (error) { ... } }`
   replaces `Effect.catchTags`.
2. **Binding clients as direct calls.** `const bucket = Cloudflare.R2.ReadWriteBucket(Notes())`,
   `bucket.get(key)` and `note.text()` replace each `yield*`.
3. **`provide` around the Worker's init.** The Worker's third argument is
   `() => { provide Cloudflare.R2.ReadWriteBucketBinding { return makeApi() } }`,
   in place of `makeApi.pipe(Effect.provide(...))`.
4. **Resources and programs held as functions.** `export const Notes = () => Cloudflare.R2.Bucket("Notes", ...)`,
   and the stack runs the Worker with `Api()`, where TypeScript writes
   `yield* Api`.

Framework specifics: `Alchemy.Stack(name, { providers, state }, init)`,
`Cloudflare.Worker(name, { main: import.meta.url }, init)`, the init returning
`{ fetch }`, and binding services such as `ReadWriteBucket` with their
`...Binding` layers.

### Sharp edges

- **Top-level resources are `EK1001`.** Alchemy declares
  `export const Notes = Cloudflare.R2.Bucket(...)`, an Effect at module top
  level. VibeLang rejects running a program there: hold it as a function and
  call `Notes()` where it is bound.
- **`fetch` must be an Effect.** `{ fetch: handle }` is a function, and
  `Cloudflare.Worker` rejects it (`TS2345`). Declaring the object's type,
  `const api: Cloudflare.WorkerShape = { fetch: handle }`, converts `handle`
  into a program.
- **Alchemy's errors and `match`.** `when Cloudflare.R2.R2Error:` matches but
  does not remove `R2Error` from the error channel: the class comes from a
  `.d.ts` file, so the arm covers nothing (rule 7 of the VibeLang skill). Match
  the tag: `when { _tag: "R2Error" }:`.
- **The handler's error channel is closed.** Alchemy's `HttpEffect` allows
  only `HttpBodyError | HttpServerError`, so both versions must handle
  `R2Error` (`TS2345` otherwise). The TypeScript original needed this too.
- **Calling a Worker was `TS2349`.** The Worker's type is
  `Effect<...> & Named<...> & PlatformIdentity<...>`; the compiler treated
  only a bare Effect type as a program value. Fixed by the compiler commit
  that lands before these examples, with the case
  `typescript/vibelang/cases/program-value-intersection`.
- **Resources read the Stack.** `Cloudflare.R2.Bucket(...)` needs Alchemy's
  `Stack` service (`Service not found: Stack` outside the CLI); tests provide
  `{ name, stage, resources: {}, bindings: {}, actions: {} }`. There is no
  published `@alchemy.run/test` package.
- **`alchemy plan` needs credentials.** With no profile it stops:
  `Provider 'Cloudflare' is not configured in profile 'default'`. With
  placeholder environment variables and an unreachable proxy, it still
  requested `api.cloudflare.com/.../workers/scripts/...` and
  `.../r2/buckets/...` for an empty local state. Docs must not present plan as
  credential-free.
- **Deploying `.vibe` is unverified.** Alchemy imports `alchemy.run.ts` and
  bundles the Worker's `main` itself; neither path has a `.vibe` loader here.
  The Alchemy migration hit the same gap ("Bun runner has no .vibe loader"). Docs
  should show the stack's code and the credential-free test, not
  `alchemy deploy` of `.vibe` sources, until someone wires
  `vibelang-unplugin` into Alchemy's build and deploys it.

### Which snippets compile in the docs harness

| Snippet | Harness result |
| --- | --- |
| `error MissingNote` with a handler over a `Map`, `HttpServerRequest()` and an exhaustive `match` | `ok` |
| The TypeScript `Data.TaggedError` original | `ok` |
| Anything importing `@alchemy.run/cloudflare` or `alchemy` | `fail`: `TS2307 Cannot find module '@alchemy.run/cloudflare'` |
| The same with `// fragment` | `fragment` |

So: mark Worker, Stack and binding panes `// fragment` and link to
`examples/alchemy-stack`; the error-and-match excerpt can stay checked.

## Real migration code

`foldkit-app/pairs/README.md` has three pairs from Foldkit batches 01–03
(`submodelPath`, `calendarDate`, `rule`), each passing Foldkit's 3022 tests
with identical declarations. `alchemy-stack/pairs/README.md` has two pairs
from Alchemy's `Telemetry.ts`, which compiled but was reverted because
`service` and `schema` changed its public declarations.
