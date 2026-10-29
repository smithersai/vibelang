### 7. Concurrency

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

Ordinary calls run in sequence. Concurrency is always an explicit combinator or keyword, and its concurrent parts are programs, so they start only when the combinator starts them.

#### Running several things at once

```ts effect
const dashboard = Effect.fn("dashboard")(function* (id: string) {
  const [profile, orders] = yield* Effect.all([loadProfile(id), recentOrders(id)], {
    concurrency: 2
  })
  return { profile, orders }
})
```

```ts es
function dashboard(id: string) {
  const [profile, orders] = all([() => loadProfile(id), () => recentOrders(id)], {
    concurrency: 2
  })
  return { profile, orders }
}
```

```ts es
const thumbnails = forEach(images, (image) => resize(image), { concurrency: 8 })
const fastest = race(() => fromCache(id), () => fromNetwork(id))
const first = await.race [fromCache(id), fromNetwork(id)]
const quick = timeout(() => slowQuery(id), "500 millis")
```

A combinator takes its programs as functions, written `() =>`. The keyword forms, `fork`, `await.all`, `await.allSettled`, `await.race`, `await.any`, and `for concurrent`, take their operands as programs by syntax: `fork`'s operand, a loop's body, and each element of an await operation's literal operand, whatever its type, so `await.race [fromCache(id), fromNetwork(id)]` starts each call in its own fiber.

Each combinator has its own rule for a failing branch; VibeLang adds nothing to Effect's semantics:

| Combinator | Succeeds with | When a branch fails |
| --- | --- | --- |
| `Effect.all`, `Effect.forEach` | Every result, in order | Interrupts the other branches, waits for their cleanup, fails with that failure |
| `Effect.race` | The first success | Keeps waiting; fails only if both fail, with both failures |
| `Effect.raceFirst` | The first to finish, success or failure | Fails if the first to finish failed; interrupts the other |
| `Effect.timeout` | The program's result | At the deadline, interrupts the program and fails with `Cause.TimeoutError`. The interrupted program's cleanup failure can be absent from this exit (D256) |
| `join [a, b]` | Every fiber's value, same shape | Interrupts the other fibers, waits for their cleanup, fails with that failure |
| `await.all [a(), b()]` | Every result, same shape | Interrupts the other elements, waits for their cleanup, fails with that failure |
| `await.allSettled [a(), b()]` | Every success or typed failure as a `Result`, same shape | Never fails with a typed error; defects and interruption propagate exactly as in `Effect.all` with `mode: "result"` (D258) |
| `await.race [a(), b()]` | The first to finish, success or failure | Fails if the first to finish failed; interrupts the others |
| `await.any [a(), b()]` | The first success | Keeps waiting; fails only if every element fails, with every failure |
| `for concurrent` | Nothing: the loop runs its body per item | Interrupts the other items, waits for their cleanup, fails with that failure |

A `catch` sees the expected failure the combinator reports. When `Effect.race` fails because both branches failed, `catch` receives the first failure (Chapter 3). The racing forms, `Effect.race`, `Effect.raceFirst`, `Effect.timeout`, and `await.race`, keep Effect's rule for a loser: they interrupt it, its cleanup runs, and they drop its exit, so a failure in the loser's cleanup does not reach the caller (D256). Cleanup that VibeLang runs itself never drops a failure (Chapter 17); to observe a child's cleanup failure, fork it and `join` it.

#### Interrupting several fibers

When `join` of several fibers, an `await` operation, or `for concurrent` interrupts the fibers still running, because one failed or one won, it requests interruption of all of them before it waits for any, then waits for every one's cleanup to finish (D354), as Effect's own `Fiber.interruptAll`, concurrent `Effect.forEach`, and `Effect.raceAll` do [Effect]. Interrupting one fiber and waiting for its cleanup before interrupting the next would deadlock when one sibling's cleanup waits for another's:

```ts es
function settle(ready: Deferred.Deferred<void>) {
  return await.race [
    do {
      try { Effect.never() }
      finally { ready.await() }                       // this cleanup waits for the next one's
    },
    do {
      try { Effect.never() }
      finally { Deferred.succeed(ready, undefined) }
    },
    do { "winner" }
  ]
}
// both losers are interrupted at once, so both cleanups finish, then "winner"
```

A form that interrupts several branches signals every one before it waits for any to finish its cleanup, as `Fiber.interruptAll` does, so one branch's cleanup can wait for a sibling's.

#### Background work with a lifetime

`fork` starts a program on a new fiber owned by the region around it: the function body, one iteration of a loop, a `try`, `catch`, or `finally` block, a block that declares `using`, or a `provide` or mask block (D408). When the region exits by any path, it interrupts the fiber and waits for its cleanup before releasing anything acquired earlier in it. A function body is such a region, so `fork` needs no `using` nearby.

```ts effect
const serve = Effect.fn("serve")(
  function* (port: number) {
    const http = yield* Http
    const server = yield* http.listen(port)
    yield* Effect.forkScoped(heartbeat())
    return yield* server.awaitShutdown()
  },
  Effect.scoped
)
```

```ts es
function serve(port: number) {
  using server = Http.listen(port)
  fork heartbeat()          // interrupted when serve exits, before the server closes
  return server.awaitShutdown()
}
```

`fork` is a keyword (D166): `fork buildReport(id)` forks one call; `fork { ... }` forks a block. It returns a `Fiber`; `join` waits for it (D225):

```ts es
function withProgress(id: string) {
  const pending = fork buildReport(id)
  sendProgressEmail(id)
  return join pending           // waits for it; fails if it failed
}
// Report!ReportError | MailError!Reports | Mailer
```

A `fork` whose operand's type is a program, definitely an Effect or a function with no required parameters, is EK4613, since the new fiber's result would be that program unrun: `fork job` with `const job = () => heartbeat()` forks nothing, so write `fork job()` (D433). `fork` adds the child's requirements to R and nothing else: the fiber cannot outlive `withProgress`, so no `Scope` appears in the contract, and its failures reach you only through `join`. `fork(buildReport(id))`, with parentheses, is the same keyword with a parenthesized operand, unless `fork` resolves to a binding other than the prelude's own, which the program declares or imports; then it is an ordinary call of that binding (Chapter 13, rule H5, D391). Either way it parses as a call, so what follows its `)` applies to its value: `fork(buildReport(id)).join()` forks the work and joins the fiber (D452). `join(x)` follows the same rule. The prelude's `fork` and `join` are used only under those names: an import that renames either, a member of a namespace import of the runtime, or a reference that stores one, is EK4410 (D432, D452). For a longer lifetime, say so: `forkIn(scope, () => program())` ties the fiber to a scope you hold, `detach(() => program())` to nothing (D170), `Effect.forkScoped(() => program())` to the caller's scope (adding `Scope` to R), and `Effect.forkChild(() => program())` to the current fiber.

**Ownership** [Rule] (D353, D386, D408). A fiber's owner is the innermost region around its `fork` that the source names: a function body, an arrow function's expression body included, so `() => fork p()` and `() => { return fork p() }` mean the same; one iteration of a loop body, a `for concurrent` item's included; a `try`, `catch`, or `finally` block; a block that declares `using`; or the block of `provide` or of a mask. A block that is only braces, such as an `if` branch, a `switch` case, a labeled block, or a bare block statement, owns nothing, so `if (ready) fork work()` and `if (ready) { fork work() }` mean the same, and adding or removing those braces changes nothing (Chapter 28). A `do` expression's block and a `match` expression's arms are such blocks: a fiber forked inside one belongs to the region around the `do` or the `match`, as one forked in an `if` branch belongs to the region around the `if` (D464). The owner interrupts the fibers it owns when it exits, newest first, interleaved in reverse order with its `using` releases (Chapter 26). That exit closes the region's Scope one owned thing at a time, as Effect closes a Scope, so a fiber forked later is gone before an earlier one is interrupted and before an earlier resource is released; to interrupt several of a region's fibers at once, call `Fiber.interruptAll` on them.

**A fiber stays with its owner** [Rule] (D409). An owned fiber is interrupted by the time anything outside its region could use it, so the value a `fork` gives may go only to these places, each checked from the source, directly or through parentheses or a conditional's arms (D455): a `const` or `let` declared in the owning region, and reads of it there; the operand of `join`, and an element of an array or object literal written as that operand, or held in a `const` or `let` of the owning region whose every read, and there is at least one, is such an operand or an argument of a `Fiber` function allowed here, as in `const fibers = [fork a(), fork b()]` then `Fiber.joinAll(fibers)` (D469); an argument of the prelude's `interrupt`, or of a function of the pinned `Fiber` module whose result type holds no `Fiber`, and the methods those functions give a fiber (D152), such as `pending.interrupt()`; and the operand of a `fork`, an element of an await operation, or the body of a `for concurrent` loop written in the same region, which finish before the region does, where the fiber is read directly: a function literal or block param inside such an operand that captures the fiber is EK4838, as a capture anywhere is (D464). Anything else is EK4838, an error: returning it, alone or inside an object or array; assigning it to a binding or property declared outside the region; storing it in any other collection, or reading such a literal's binding any other way, `fibers.length` included; passing it to any other call; or capturing it in a function literal or block param. A fiber that needs a longer lifetime says so: `Effect.forkScoped`, `forkIn`, or `detach`. To bound a `join`, race it in the same region instead of capturing the fiber in a function: `await.race [join f, do { sleep("5 seconds"); throw new Late() }]`. A plain `await f` of an owned fiber is EK4609, whose quick fix writes `join f`, and only EK4609: the more specific error stands alone, and EK4838 does not also report the fiber going to the `await` (D464).

```ts es
function startHeartbeat() {
  return fork heartbeat()
}
```

```text
error EK4838: This fiber is owned by startHeartbeat's body, which interrupts it on exit,
  but it is returned from that body.
  heartbeat.vibe:2:10   return fork heartbeat()
  Give it the caller's lifetime:   return Effect.forkScoped(() => heartbeat())
  Or give it no owner:             return detach(() => heartbeat())
```

`join` waits for a `Fiber`, or an array or object of fibers, keeping the shape (`Fiber.join`). Its operand's type must be a `Fiber`, an array or tuple of them, or an object type whose every property and index signature has a `Fiber` type; anything else is EK4611. It reads its operand once, and each element of an array or object once, and joins exactly the fibers it read. It adopts each fiber's Exit: a fiber that failed, died, or was interrupted makes `join` fail with that fiber's whole cause. When one fiber fails, `join` interrupts the others still running, under the rule above, and propagates the failure, failing fast like `Effect.all`. A `Deferred` waits with its method, `d.await()` (D227):

```ts effect
const summary = Effect.fn("summary")(function* (id: string) {
  const profile = yield* Effect.forkChild(loadProfile(id))
  const orders = yield* Effect.forkChild(recentOrders(id))
  const [p, o] = yield* Fiber.joinAll([profile, orders])
  return { profile: p, orders: o }
})
```

```ts es
function summary(id: string) {
  const profile = fork loadProfile(id)
  const orders = fork recentOrders(id)
  return { profile: join profile, orders: join orders }
}
```

To start several programs and wait for them in one step, use an await operation, `await.all [loadProfile(id), recentOrders(id)]` (below), instead of forking each.

`await` waits for promises in JavaScript, so in VibeLang code a plain `await` is an error that names its replacement (D226): `await fiber` is EK4609 (quick fix: `join fiber`); `await d` on a Deferred is EK4610 (quick fix: `d.await()`); `await loadProfile(id)` is EK4601, because a call already runs and waits where it stands; a promise is EK4602 and waits in a hatch, `try(async () => …)`, where `await` keeps its JavaScript meaning; anything else is EK4603. An `await` in a hatch's function that is not `async` is EK4604. `join` on anything but fibers is EK4611, and inside a hatch's function, which is plain TypeScript, EK4612.

#### Await operations

`await.all`, `await.allSettled`, `await.race`, and `await.any` (D196) come from the TC39 [await operations](https://github.com/tc39/proposal-await.ops) proposal (stage 1) and, for an object operand, the [Await Dictionary](https://github.com/tc39/proposal-await-dictionary) proposal (stage 3). Each combines its elements' outcomes as the same-named `Promise` method does.

An await operation runs where it stands [Rule] (D377, D394). When its operand is an array or object literal, every element is a program by syntax, whatever its type: nothing in it runs until the operation starts it, in its own fiber, and each run of the enclosing program starts it afresh. An element's result is its program's success value, which is never run or waited for again, so `await.all [exit(() => a()), exit(() => b())]` gives two `Exit` values. An element whose type is a program, definitely an Effect or a function with no required parameters, is EK4613, since its result would be that program unrun: write `job()` to run it. An element of `Fiber` or `Deferred` type is EK4609 or EK4610: write `join f`, or `d.await()`, as the element. The literal's own parts are evaluated once, in source order, when the operation runs: an object literal's computed keys, and spread elements, whose iterables are drained then, with the iterator closed if a step fails (Chapter 17); keys keep that order. A value a spread contributes is an element by its type, as a non-literal operand's is (below). Where two keys of an object operand are equal, the later element replaces the earlier, as in an object literal, and only the kept element's program starts.

Any other operand is evaluated once, when the operation runs, and then enumerated once: an iterable's iterator is taken and drained, an object's own enumerable keys are read in order. Its element type decides how each element runs: an element type that is definitely an Effect (Chapter 13, rule R) runs on its own fiber, and a function type with no required parameters converts to a program and runs so (D49, D381). Any other element type, an `Exit`, a `Config`, or a union with a non-program member included, is EK4603, and a `Fiber` or a `Deferred` is EK4609 or EK4610. No run-time test decides, so an element whose static type is data under rule R, such as an `Exit`, never runs here; an `Exit` held in an `Array<Effect<A>>`, which that type admits, runs as the Effect it also is. The result has the operand's shape, with each element's success type. A program that holds an await operation, such as `() => await.all xs`, enumerates `xs` again on every run.

```ts effect
const next = (jobs: Queue.Queue<Job>, shutdown: Deferred.Deferred<void>) =>
  Effect.raceAllFirst([
    Effect.map(Queue.take(jobs), (job) => run(job)),
    Effect.as(Deferred.await(shutdown), "stopped"),
    Effect.flatMap(Effect.sleep("30 seconds"), () => heartbeat())
  ])
```

```ts es
function next(jobs: Queue.Queue<Job>, shutdown: Deferred.Deferred<void>) {
  return await.race [
    run(jobs.take()),
    do {
      shutdown.await()
      "stopped"
    },
    do {
      sleep("30 seconds")
      heartbeat()
    }
  ]
}
```

- `await.all [a(), b()]` and `await.all { x: a(), y: b() }` are `Effect.all` with unbounded concurrency.
- `await.allSettled` is `Effect.all` with `mode: "result"`.
- `await.race` is `Effect.raceFirst` over any number of elements. Of elements ready at once, the first written wins. An empty race never finishes, as `Promise.race([])` does not.
- `await.any` is `Effect.raceAll`.
- A `do { ... }` expression (D187) gives an element statements of its own. A race over an object is EK4608.
- **Controversial** (D196): `await.x` behaves like `Promise.x`, while a named Effect function keeps Effect's meaning, so `await.race [a(), b()]` takes the first to finish and `race(() => a(), () => b())` the first success. The hover on each names the rule it follows.
- `select` (D168) was replaced by `await.race` (D197) and is EK4607. To poll without waiting, test `Queue.poll`'s result with an `if`.

#### Concurrent loops

`for concurrent` runs its body for each item in its own fiber and joins them all before the loop ends (D169). `for concurrent(n)` runs at most `n` at once:

```ts effect
const saveAll = (ids: ReadonlyArray<string>) =>
  Effect.forEach(ids, (id) => Effect.flatMap(fetchPage(id), save), { concurrency: 8, discard: true })
```

```ts es
function saveAll(ids: ReadonlyArray<string>) {
  for concurrent(8) (const id of ids) save(fetchPage(id))
}
```

The head is evaluated in source order, each part once, when the loop runs: the bound `n`, then the iterable (D354). The iterable is then enumerated once. The head's binding keeps its declaration kind: a `const` item is a `const` in each item's body, so assigning to it is TypeScript's TS2588, as in an ordinary `for...of`. `continue` ends one item. Because each item runs in its own fiber, a `break` that would leave the loop is EK4605 and a `return` is EK4606; throw to stop every item. Use `forEach` for the results.

#### What a new fiber sees

A forked fiber starts with the services of the code that forked it, as in Effect; later changes in either fiber do not reach the other. Handlers are the one thing that does not cross to a new fiber; Chapter 9 introduces them and shows the compiler's check.
