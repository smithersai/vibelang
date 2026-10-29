## Essentials

Functions are Effects; calls run in order without `yield*`. `A!E`: result/failures; `A!!`: cannot fail. Omissions are inferred.

```vibe
error NotFound { id: string }

service Users { name(id: string): string!NotFound }

function nameOf(id: string): string!!Users {
  // timeout bounds each attempt
  return retry(() => timeout(() => Users.name(id), "1 second"), {
    times: 3,
    schedule: Schedule.exponential("100 millis")
  }) catch (e) => "unknown"
}

export function names(ids: ReadonlyArray<string>) {
  return forEach(ids, nameOf, { concurrency: 8 })
}
```

- `throw new NotFound({ id })` fails; `x catch (e) => y` and `try { } catch (e) { }` recover; `match (e) { when NotFound: ...; default: throw e; }` picks error classes.
- Imports keep extensions: `"./user.vibe"`. Effect's modules are in scope.
- `.ts`: import `"./user.vibe"`; run its Effect with `Effect.runPromise` from `effect`; include `src/**/*.ts` in tsconfig.
- `provide UsersLive { ... }` supplies `Users`; `const UsersLive = Layer.succeed(Users, { name(id) { ... } })`.
- `await.all [a(), b()]` runs both; `%` is `x` in `x |> f(%)`.
- TypeScript bodies: `let`, loops, `typeof`, regex, Array/Map methods.
- `using h = acquire()` frees it once on block exit, even on interruption. `yieldNow()` first honors interrupts.
- A plain TypeScript call needs `sync((x) => f(x), x)`; if it can throw, `try Effect.try({ try: () => f(x), catch: (error: unknown) => new E() })`.
- `@effect/vitest`: `it.effect("name") { assert.strictEqual(a, b) }` uses a test clock (`sleep` stalls); `it.live`: real time. Vitest hides `console.log` under agents; assert.
