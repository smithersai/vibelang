# Users and layers

A directory-backed greeting uses `service` declarations, typed errors, a
`catch` expression, and layers composed with `Layer.provideMerge`.
The directory is captured when `UsersLive` builds, so lookups need only `Users`.
Tests replace the live graph with `UsersTest` and check missing-user recovery.

From this directory, with `vibelang` on `PATH`:
```sh
bun install
bun run build
bun run start
bun run test
```

`src/main.test.vibe` uses `it.effect`; Vitest runs the source
through `vibelang-vite`, with assertion stacks mapped to `.vibe` lines.
Assertions run inside `Effect.try`, an explicit boundary for foreign code.
The lookup in Effect TypeScript is:
```ts
const find = Effect.fnUntraced(function* (id: string) {
  const user = yield* directory.lookup(id)
  if (user === undefined) return yield* Effect.fail(new UserNotFound({ id }))
  return user
})
```

The CLI prints a welcome for Ada and a fallback for the missing user.
