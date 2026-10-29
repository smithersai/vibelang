## Essentials

`effect function` returns an Effect; `try e` runs it in effect code. `A!E!R` is `Effect<A, E, R>`; empty slots: `never`.

```vibe
// pending: VIP-1, VIP-6, VIP-9, VIP-13
error NotFound { id: string }
service Users { name(id: string): string!NotFound }

effect function nameOf(id: string) {
  const users = try Users
  const attempt = timeout(users.name(id), "1 second")
  return retry(attempt, { times: 3 }) catch "unknown"
}

export effect function names(ids: ReadonlyArray<string>) {
  return try forEach(ids, nameOf, { concurrency: 8 })
}
```

- `throw e` fails in effect code. `x catch value`, `x catch (e) => value`, `x catch effect (e) => { … }` and `x catch effect { … }` recover. Effect handlers fail with `throw`; plain handlers throw defects. `catch` binds like `??`; parenthesize mixtures with `??`, `||`, `&&`.
- No `try` statements in effect code, including `try`/`finally`; use `ensuring` or `onExit`. `@throws` is only for non-Effect functions; Effect failures use the error channel.
- Imports keep `"./user.vibe"`. Effect modules and functions are global. Provide platform services; run `NodeRuntime.runMain(main())` yourself.
- Plain and `async` functions are TypeScript's. `await` is Promise-only. Wrap a Promise: `try tryPromise(() => load())`; a throwing call: `try Effect.try(() => f(x))`.
- `const UsersLive = Layer.succeed(Users, { effect name(id) { return id } })`; `provide UsersLive { … }` supplies it. `try.all [a(), b()]` runs both concurrently; `fork w()` starts a fiber, `join f` waits.
- Resources: `try scoped(effect { const h = try acquireRelease(open(), close); … })`.
- Tests: `it.effect("name", () => effect { … })` uses a test clock: `try TestClock.adjust("1 second")`. `it.live` uses real time. Assert.
