# VIP-8: special syntax for Effect resources (`using` and a `scoped` keyword), denied

**Status:** denied by Will, 2026-10-28. VibeLang has no special syntax for Effect resources. `using` keeps exactly TypeScript's meaning, and Effect resources use Effect's own `scoped` (a VIP-6 global).

```ts
effect function load(p, q) {
  using f = openFile(p)            // TypeScript's using: f[Symbol.dispose]() at the end of the block
  return try scoped(effect {       // Effect resources: Effect's own scoped
    const db = try openDb()
    return try db.query(q)
  })
}

// Effect TS
const load = (p, q) => Effect.scoped(Effect.gen(function* () {
  const db = yield* openDb()
  return yield* db.query(q)
}))
```
- **Amended 2026-10-29: a warning for `using` in effect code.** There it leaks on a failure or interruption, so it gets a warning, with a quick fix to `acquireDisposable` inside `scoped`. `using` keeps TypeScript's meaning. Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.

## What was proposed

**A. No syntax.** `using` keeps TypeScript's meaning, and Effect resources use `scoped(effect { … })`. This is the outcome of the denial.

**B. `try` in the initializer marks an Effect resource, owned by the block.**
```ts
effect function load(q) {
  using db = try openDb()          // Effect.scoped around the block + yield* openDb()
  using f = openFile(p)            // Effect.acquireDisposable
  return try db.query(q)
}
```

**C. The initializer's type decides between an Effect resource and a Disposable.** This was today's spec (D94 through D553).

**A `scoped` keyword.** `try scoped { … }` as sugar for `scoped(effect { … })`. It is ambiguous as sketched: `scoped(x)` parses as a call or as the keyword, and VIP-6 would remove the global, breaking `pipe(program, scoped)`. Will: "A little bit of ambigiouty is unacceptable."

## History

About 35 review findings over 10 rounds: 13 in rounds 2 to 4, 17 in rounds 6 to 8, and 4 after the D490 ruling.

| Problem | Kind | Status before this VIP |
| --- | --- | --- |
| Is the initializer an Effect to acquire or a Disposable? A type decided (D94 to D553). | lego | open |
| Invented interruption masks, rewritten three times (D425, D451, D459) | lego | fixed by D490 (Effect's `acquireRelease`) |
| Double release: the acquisition's finalizer plus `using`'s dispose | local | fixed (D342) |
| Which block owns a resource (D47, D408) | lego | fixed (D408) |
| `using` in a layer's setup | local | fixed (D344) |

Why it was hard: Effect has no block scope. A resource lives until the nearest `Effect.scoped`, so block-scoped `using` needed rules about which block is a scope, on top of telling two kinds of initializer apart. With no special syntax, none of these rules exist.

## Effect's scope functions (effect 4.1.0)

```ts
scoped(self: Effect<A, E, R>): Effect<A, E, Exclude<R, Scope>>   // a fresh Scope, closed when self ends
scopedWith((scope: Scope) => Effect<A, E, R>): Effect<A, E, R>   // the same, with the Scope passed as a value
scope: Effect<Scope, never, Scope>
acquireRelease(acquire, (a, exit) => release, { interruptible?: boolean })
acquireDisposable(acquire)
addFinalizer((exit) => cleanup)
```

## Will's words

> "So very concisely why is this so problematic? I expected this to be just a simple 1 to 1 transformation from our code to the matching effect code?"

> "Ok I'm wondering if we need special syntax for this"

> "If I ask a question like is there ambiguity the answer is yes or no. A little bit of ambigiouty is unacceptable"

> "Ok we should deny this. Deny it by keeping the proposal info about what we talked about and appending it to the end as a denied VIP"

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


D14, D25, D94, D95, D342, D343, D344, D401, D425, D451, D459, D481, D490 and D553: the `using` rules for Effect resources.
