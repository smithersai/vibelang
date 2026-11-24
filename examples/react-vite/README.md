# React and Vite

A React component renders greetings that a VibeLang program computes.
`src/users.vibe` declares a `User` schema, a `UserNotFound` error, and a
`Users` service with the `UsersLive` layer. `greet` looks up a user and
recovers `UserNotFound` with a `catch` expression, so its contract is `string!!Users`:
it cannot fail. `src/Greeting.tsx` runs `greet(id)` with a `ManagedRuntime`
built from `UsersLive` and renders `Loading…` until the program completes.

## Run the app

From this directory, install the published packages and start Vite.

```sh
bun install
bun run dev
```

Open the URL that Vite prints. The page shows `Loading…` for each greeting,
then:

```text
Users
Welcome, Ada Lovelace
No user 404
```

## Test the app

```sh
bun run test
```

The command stops at the first failure. It runs three steps:

1. `vibelang -p tsconfig.json --noEmit` type-checks `src/users.vibe` and every
   `.ts` and `.tsx` file as one program.
2. `vitest run` runs two files. `src/users.test.vibe` checks `greet`, the
   `UserNotFound` failure, and its recovery with `@effect/vitest`.
   `src/App.test.tsx` renders `App` in happy-dom with Testing Library, checks
   the loading text, and waits for both greetings.
3. `vite build` writes the production bundle to `dist/`.

The output ends with:

```text
 Test Files  2 passed (2)
      Tests  4 passed (4)
...
✓ built in 216ms
```

## How the pieces connect

- `vite.config.ts` lists `vibelang()` from `vibelang-vite` before `react()`. The
  plugin compiles the project with the `vibelang` binary, and Vite serves each
  `.vibe` module as JavaScript. Vitest reads the same file.
- A `.tsx` file imports `./users.vibe` by its source name.
  `"rewriteRelativeImportExtensions": true` in `tsconfig.json` permits that
  import. Without it, the compiler reports TS5097.
- To TypeScript, `greet` is a function that returns
  `Effect<string, never, Users>`. `runtime.runPromise` provides `Users` and
  returns a `Promise<string>`. The component passes an `AbortSignal`, so an
  unmount interrupts the program.

## Coming from Effect

`greet` in Effect TypeScript:

```ts
// TypeScript (.ts)
const greet = Effect.fnUntraced(function* (id: string) {
  const users = yield* Users
  return yield* users.find(id).pipe(
    Effect.map((user) => `Welcome, ${user.name}`),
    Effect.catchTag("UserNotFound", (error) => Effect.succeed(`No user ${error.id}`))
  )
})
```
