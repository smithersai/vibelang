# VIP-18: running Effects concurrently: `try.all`, `try.race`, `try.any`, `try.allSettled`

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
const [u, o] = try.all [fetchUser(id), fetchOrders(id)]  // yield* Effect.all([…], { concurrency: "unbounded" })
const fast   = try.race [primary(), mirror()]            // yield* Effect.raceAllFirst([…])   first to finish
const ok     = try.any [primary(), mirror()]             // yield* Effect.raceAll([…])        first to succeed
const rs     = try.allSettled [a(), b()]                 // every element's Result; none fails the whole
```

- These are TC39's await operations, run with `try` (VIP-5) instead of `await`. Each is exact sugar for an Effect function.
- The names keep JavaScript's meanings: `try.all` runs everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time. `try.race` gives the first to finish, and `try.any` the first to succeed.
- They use the same `keyword.name` shape as VIP-17's `fork.in`.
- **Ambiguity: none.** `try` is a reserved word, so `try.` can't start anything else.

## History

About 37 findings over rounds 2 to 11, about when elements are evaluated and about `do` elements. VIP-1, VIP-2 and VIP-5 removed both, and none apply to this design.

## Prior art

`Promise.all`, `race`, `any` and `allSettled`; TC39's await-operations proposal.

## Will's words

> "this is a yes"
