# Running Effects

Sources: [VIP-5](../vips/0005-try-runs-effects.md), [VIP-2](../vips/0002-effect-blocks-and-do.md), [VIP-17](../vips/0017-fork.md), [VIP-18](../vips/0018-concurrent.md), [VIP-19](../vips/0019-for-concurrent.md), [VIP-20](../vips/0020-for-try.md), [VIP-21](../vips/0021-producers.md), [VIP-22](../vips/0022-interruption-blocks.md), [VIP-23](../vips/0023-pipe.md).

A call never runs anything. Calling an `effect` function, or any function that returns an Effect, gives the Effect unrun. An Effect runs only where one of these constructs runs it, inside an `effect` function or an `effect` block:

| Construct | Runs |
| --- | --- |
| `try e` | one Effect, giving its success |
| `e catch y` | one Effect, handling its failure |
| `fork e` and its forms | one Effect, in a new fiber |
| `try.all`, `try.race`, `try.any`, `try.allSettled` | several Effects at once |
| `for concurrent` | one Effect per item, at once |
| `for try` | one Effect per Stream element, in order |
| `provide`, `uninterruptible`, `interruptible` | a block of statements ([Services](005-services.md#provide-blocks) for `provide`) |

In this chapter, "effect code" means the body of an `effect` function or an `effect` block, not counting functions nested inside it.

Every operand is evaluated once, left to right as written, with three exceptions: a `catch` handler is evaluated only on failure; the body of an `effect` block or function is evaluated on each run; and `fork.in(scope) e` evaluates `e` before `scope`, as VIP-17's `Effect.forkIn(e, scope)` does. Where Effect's argument order differs from the source order elsewhere (`for concurrent(n) (… of xs)`), the Effect TypeScript evaluates the operands into temporaries first.

## `try`

### Syntax

```text
TryExpression = "try" UnaryExpression
```

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `try` outside effect code | code pending |
| `try e` where `e` is not an Effect. A call that may throw, and a Promise, must first be wrapped with `Effect.try`, `tryPromise` or `promise` | code pending |
| a `try` statement (`try { } catch { }`, `try { } finally { }`) anywhere in effect code. Handle failures with `catch` or `match`, and clean up with `ensuring` or `onExit`: `try ensuring(write(x), close())` | code pending |

An Effect that can't fail is still run with `try`.

`try` works like `await`: it is a unary operator with `await`'s precedence, so `try a.b()` runs `a.b()` and `try f() + 1` adds 1 to the success. As with `await`, the operand may start on the next line. At the start of a statement, `try {` begins a `try` statement, as in JavaScript, and that is an error in effect code.

### Meaning

`try e` is `yield* e`. It runs `e` and gives its success value. A failure propagates to the enclosing Effect, as Zig's `try x` means `x catch |err| return err`.

```vibe es
// compiler-gap: pending VIP-5
effect function load(id: string) {
  const u = try fetchUser(id)
  try sleep("1 second")
  return u
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const u = yield* fetchUser(id)
    yield* Effect.sleep("1 second")
    return u
  })
}
```

## `catch`

### Syntax

```text
CatchExpression = CatchExpression "catch" Handler
                | Operand "catch" Handler
Operand         = BitwiseORExpression    (the operand of ??)
Handler         = HandlerFunction        (a function of the error)
                | "effect" Block         (an effect block)
                | Operand                (a value)
HandlerFunction = EffectArrow            (an effect function)
                | ArrowFunction          (a plain function)
                | "(" HandlerFunction ")"
```

The first alternative that matches wins, so the handler alternatives are tried before `Operand`. Parentheses around an arrow literal, at any depth, keep it a handler. Parentheses around an `effect` block, or around a name, make it an `Operand`.

| Written | Handler kind | On `fail("bad")` gives |
| --- | --- | --- |
| `x catch (e) => 7` | plain function | `7` |
| `x catch ((e) => 7)`, `x catch (((e) => 7))` | plain function | `7` |
| `x catch (effect (e) => 7)` | effect function | `7` |
| `x catch effect { return 7 }` | effect block | `7` |
| `x catch (effect { return 7 })` | value | the unrun Effect |
| `x catch f`, `x catch (f)` (`f` a function value) | value | the function `f` |

`catch` has the precedence of `??` and is left-associative: `a catch b catch c` means `(a catch b) catch c`, and `x = a catch b` assigns the result. A value handler is an `Operand`, so `x catch y, z` is a comma expression whose first part is `x catch y`.

An arrow handler's body is TypeScript's concise body, which extends as far as an assignment expression does, as in `(e) => a ?? b`. So `a catch (e) => b catch c` means `a catch ((e) => (b catch c))`. Parenthesize the arrow to chain: `a catch ((e) => b) catch c`.

In `(a catch b) catch c`, the outer `catch` runs the value that `a catch b` gives, so that value must itself be an Effect. To try fallbacks in turn, nest them in the handler: `a catch effect { return b catch c }`.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `catch` outside effect code | code pending |
| `try x catch y`: write `try x` or `x catch y`, never both | code pending |
| `e catch y` where `e` is not an Effect | code pending |
| `catch` mixed with `??`, `\|\|` or `&&` without parentheses, as JavaScript requires for `??` | code pending |

### Meaning

`e catch y` runs `e`. On a failure in its error channel it evaluates `y`, as Zig's `catch` takes a value or `|err|`. The handler's syntax decides whether it runs Effects, as for any function:

| Written | Effect TypeScript |
| --- | --- |
| `x catch guest` (a value) | `yield* Effect.catch(x, () => Effect.succeed(guest))` |
| `x catch (e) => f(e)` (a plain function; a `throw` inside is a JavaScript exception, so a defect) | `yield* Effect.catch(x, (e) => Effect.succeed(f(e)))` |
| `x catch effect (e) => …` (an effect function; it runs its Effects, and `throw` fails again, typed) | `yield* Effect.catch(x, (e) => Effect.gen(…))` |
| `x catch effect { … }` (an effect block; runs the fallback) | `yield* Effect.catch(x, () => Effect.gen(…))` |

```vibe es
// compiler-gap: pending VIP-5
effect function load(id: string) {
  const g = fetchUser(id) catch guest
  const h = fetchUser(id) catch effect (e) => match (e) {
    when NotFound: guest;
    when DbError: throw e;         // fails again, typed (VIP-4)
  }
  return [g, h]
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const g = yield* Effect.catch(fetchUser(id), () => Effect.succeed(guest))
    const h = yield* Effect.catch(fetchUser(id), (e) => Effect.gen(function* () {
      if (e._tag === "NotFound") return guest              // NotFound's matcher tests _tag
      if (e._tag === "DbError") return yield* Effect.fail(e)
      throw new TypeError("no arm matched")                // TC39: a defect
    }))
    return [g, h]
  })
}
```

Syntax decides the handler kind. In `x catch f`, where `f` is an identifier, call or other non-literal whose value is a function, the fallback is the value `f`. A value fallback whose type is an Effect or a function gets a VIP-38 lint warning, with quick fixes to `catch (e) => f(e)` or `catch effect { … }` (decided 2026-10-29):

```vibe es
// compiler-gap: pending VIP-5
effect function pick(onErr: (e: NotFound | DbError) => User) {
  const a = fetchUser("1") catch onErr              // warning: gives onErr itself
  const b = fetchUser("1") catch (e) => onErr(e)    // calls onErr with the error
  return [a, b]
}
```

```ts effect
// fragment
function pick(onErr: (e: NotFound | DbError) => User) {
  return Effect.gen(function* () {
    const a = yield* Effect.catch(fetchUser("1"), () => Effect.succeed(onErr))
    const b = yield* Effect.catch(fetchUser("1"), (e) => Effect.succeed(onErr(e)))
    return [a, b]
  })
}
```

## `await`

`await` keeps exactly JavaScript's meaning and belongs to `async` functions and the module top level. `await`, `for await` and `await using` inside effect code are errors, and so is `await` on an Effect inside an `async` function ([Functions](001-functions.md#static-rules)).

## `effect` blocks

### Syntax

```text
EffectBlock = "effect" Block          (an expression)
```

### Meaning

`effect { … }` is an expression. It builds an Effect from the block without running it. Each time the Effect runs, the block runs again. It is `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`. Inside it, `try` runs Effects. Its `this`, `arguments`, `super` and `new.target` are the enclosing function's, passed in as for an `effect` arrow ([Functions](001-functions.md#meaning)).

```vibe es
// compiler-gap: pending VIP-2
effect function demo() {
  const p = effect { console.log("hi"); return 1 }   // an Effect, not yet run
  try p                                              // prints "hi", gives 1
  try p                                              // prints "hi" again
  return try retry(effect { try save(try fetchUser("1")) }, policy)
}
const UsersLive = Layer.effect(Users, effect { return makeUsers() })
```

```ts effect
// fragment
function demo() {
  return Effect.gen(function* () {
    const p = Effect.gen(function* () { console.log("hi"); return 1 })
    yield* p
    yield* p
    return yield* Effect.retry(Effect.gen(function* () { yield* save(yield* fetchUser("1")) }), policy)
  })
}
const UsersLive = Layer.effect(Users, Effect.gen(function* () { return makeUsers() }))
```

No other syntax builds an Effect. A function literal never becomes an Effect because the parameter it's passed to expects one.

## `do` expressions

`do { … }` is exactly TC39's do expression, pinned to a dated snapshot of the proposal, everywhere, with no exceptions. It runs now and gives its last statement's value. It is not a function: as TC39 specifies, `await` inside `do` belongs to the enclosing function, and so does `try`. Neither `do` nor `match` is lowered to a function, so a `try` inside one stays a `yield*` of the enclosing generator.

```vibe es
// compiler-gap: pending VIP-2
const x = do { const a = 1; a + 1 }    // 2
```

**Undecided (pending VIP):** the date of the TC39 do-expressions snapshot VibeLang pins.

## `fork` and `join`

### Syntax

```text
ForkExpression = "fork" ForkOperand
               | "fork" "." "in" "(" AssignmentExpression ")" ForkOperand
               | "fork" "." "scoped" ForkOperand
               | "fork" "." "detached" ForkOperand
JoinExpression = "join" ForkOperand
```

`fork` and `join` are contextual keywords, and the operand starts on the same line. The owner forms use JavaScript's `keyword.name` shape, like `new.target` and `import.meta`. A `ForkOperand` never contains a top-level comma, so `const f = fork a(), g = fork b()` declares two fibers.

In effect code, `fork` or `join` is the keyword where an `IdentifierReference` could stand and the next token, on the same line, can start an expression, as `await` is in an `async` function. It is never the keyword as a property name after `.` or `?.`, a property key, a label, a binding name, or an import or export name. Elsewhere, `fork` and `join` are identifiers.

```vibe es
// compiler-gap: pending VIP-17
effect function names(parts: Fiber.Fiber<string[]>) {
  const xs = join(parts)             // the keyword: joins the fiber parts
  const s = xs.join(",")             // a method call
  return (join)(xs, "/")             // calls a function named join in scope
}
```

`try`'s operand may start on the next line, because `try` is a reserved word. `fork` and `join` are not, so a line break after them ends the expression, and `fork` alone on a line is an identifier (VIP-17).

**Undecided (pending VIP):** whether effect code that uses the `fork` or `join` keyword where a binding of that name is in scope gets a warning (`fork - 1` and `join [0]` are keyword forms).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `fork` or `join` outside effect code | code pending |

### Meaning

`fork` starts a fiber and gives its `Fiber`. The form names the owner, which interrupts the fiber when it ends. A child is not awaited at the end of a scope, as Swift's and Kotlin's structured children are; it keeps Effect's meaning. A `fork` child whose parent ends first exits with an interruption; a `fork.detached` child runs to its own end.

| VibeLang | Effect TypeScript | Owner |
| --- | --- | --- |
| `fork worker()` | `yield* Effect.forkChild(worker())` | the current fiber |
| `fork.in(scope) worker()` | `yield* Effect.forkIn(worker(), scope)` | the given scope; `worker()` is evaluated before `scope` |
| `fork.scoped worker()` | `yield* Effect.forkScoped(worker())` | the current `Scope`; adds `Scope` to R |
| `fork.detached worker()` | `yield* Effect.forkDetach(worker())` | none |
| `join f` | `yield* Fiber.join(f)` | |

```vibe es
// compiler-gap: pending VIP-17
effect function both() {
  const f = fork worker()
  const mine = try other()
  return [mine, join f]
}
```

```ts effect
// fragment
function both() {
  return Effect.gen(function* () {
    const f = yield* Effect.forkChild(worker())
    const mine = yield* other()
    return [mine, yield* Fiber.join(f)]
  })
}
```

**Undecided (pending VIP):** the precedence of `fork` and `join`, that is, what `ForkOperand` is: a `UnaryExpression`, as for `try`, or an `AssignmentExpression`, as for `yield`. It decides, for example, whether `fork a() |> f(%)` forks `a()` or the pipe.

## Running Effects concurrently

### Syntax

```text
TryAll = "try" "." ("all" | "race" | "any" | "allSettled") UnaryExpression
```

`try` is a reserved word, so `try.` can't start anything else. The operand has `try`'s precedence, so `try.all [a(), b()]` and `try.all ids.map(load)` each have one reading. The operand is any expression whose type is an array, readonly array or tuple of Effects, not only an array literal (VIP-18, amended).

### Static rules

| Rule | Diagnostic |
| --- | --- |
| an operand that is not an array of Effects; an object of Effects uses the `all` global instead | code pending |

### Meaning

These are TC39's await operations, run with `try` instead of `await`. The names keep JavaScript's choice of result: `try.all` runs everything at once, like `Promise.all`, even though `Effect.all` defaults to one at a time. Unlike Promises, the Effects that lose are interrupted, and an empty operand to `try.race` or `try.any` never completes, where `Promise.any([])` rejects.

| VibeLang | Effect TypeScript | Gives |
| --- | --- | --- |
| `try.all [a(), b()]` | `yield* Effect.all([a(), b()], { concurrency: "unbounded" })` | every success, in operand order; the first failure fails the whole and interrupts the rest |
| `try.race [a(), b()]` | `yield* Effect.raceAllFirst([a(), b()])` | the first to finish, success or failure; the losers are interrupted |
| `try.any [a(), b()]` | `yield* Effect.raceAll([a(), b()])` | the first to succeed; the losers are interrupted. If every operand fails, the whole fails with all their failures in its `Cause`, in the order they occurred, and `catch` receives the first to occur, not the first operand's |
| `try.allSettled [a(), b()]` | `yield* Effect.all([a(), b()].map(Effect.exit), { concurrency: "unbounded" })` | every element's `Exit` (success, failure, defect or interruption); the whole never fails, as `Promise.allSettled` never rejects; it can still be interrupted from outside |

```vibe es
// compiler-gap: pending VIP-18
effect function page(id: string) {
  const [u, o] = try.all [fetchUser(id), fetchOrders(id)]
  const both = try all({ u: fetchUser(id), o: fetchOrders(id) }, { concurrency: "unbounded" })   // an object: the all global
  return [u, o, both]
}
```

```ts effect
// fragment
function page(id: string) {
  return Effect.gen(function* () {
    const [u, o] = yield* Effect.all([fetchUser(id), fetchOrders(id)], { concurrency: "unbounded" })
    const both = yield* Effect.all({ u: fetchUser(id), o: fetchOrders(id) }, { concurrency: "unbounded" })
    return [u, o, both]
  })
}
```

## `for concurrent`

### Syntax

```text
ForConcurrent = "for" "concurrent" ("(" AssignmentExpression ")")? "(" ForBinding "of" AssignmentExpression ")" Statement
```

JavaScript's `for` can only be followed by `(` or `await`, so `for concurrent` has one reading. After `for concurrent`, a parenthesized group followed by another `(` is the limit `n`.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `for concurrent` outside effect code | code pending |
| `break` in the body | code pending |
| `return` in the body | code pending |
| a labeled `continue` whose target is outside the body | code pending |

`continue` ends that one item: it is `return` from the item's generator, as the example shows. `break`, `return` and a labeled `continue` are errors when they would leave the body, because no loop runs on the body's fiber (VIP-19); a loop nested in the body keeps its own `break` and `continue`.

### Meaning

Every item runs in its own fiber, all at once, or at most `n` at a time with `for concurrent(n)`. `n` is any Effect `Concurrency`, which in Effect 4.1.0 is a number or `"unbounded"`, passed straight to `concurrency` (decided 2026-10-29). All items join before the loop ends, and one failure interrupts the rest. Results are discarded; `try.all ids.map(…)` keeps them.

```vibe es
// compiler-gap: pending VIP-19
effect function syncAll(ids: string[]) {
  for concurrent (const id of ids) { if (id === "") continue; try syncOne(id) }
  for concurrent(4) (const id of ids) { if (id === "") continue; try syncOne(id) }
  for concurrent("unbounded") (const id of ids) { try syncOne(id) }
}
```

```ts effect
// fragment
function syncAll(ids: string[]) {
  return Effect.gen(function* () {
    yield* Effect.forEach(ids, (id) => Effect.gen(function* () { if (id === "") return; yield* syncOne(id) }), { concurrency: "unbounded", discard: true })
    yield* Effect.forEach(ids, (id) => Effect.gen(function* () { if (id === "") return; yield* syncOne(id) }), { concurrency: 4, discard: true })
    yield* Effect.forEach(ids, (id) => Effect.gen(function* () { yield* syncOne(id) }), { concurrency: "unbounded", discard: true })
  })
}
```

**Undecided (pending VIP):** which `ForBinding`s are allowed (VIP-19 shows `const id`; `let` and destructuring are not stated), and whether the operand may be any iterable or also a Stream.

## `for try`

### Syntax

```text
ForTry = "for" "try" "(" ForBinding "of" AssignmentExpression ")" Statement
```

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `for try` outside effect code | code pending |
| `return` in the body | code pending |

### Meaning

`for try (const x of stream)` consumes a Stream, pulling one element at a time, in order. It mirrors `for await` over AsyncIterables, which keeps its JavaScript meaning. `continue` skips one element, `break` stops consuming, and a failure in the body fails the loop.

```vibe es
// compiler-gap: pending VIP-20
effect function saveAll(rows: Stream.Stream<Row>) {
  for try (const row of rows) {
    if (row.skip) continue
    if (row.last) break
    try save(row)
  }
}
```

```ts effect
// fragment
function saveAll(rows: Stream.Stream<Row>) {
  return Effect.gen(function* () {
    yield* Stream.runForEachWhile(rows, (row) => Effect.gen(function* () {
      if (row.skip) return true
      if (row.last) return false
      yield* save(row); return true
    }))
  })
}
```

**Undecided (pending VIP):** labeled `break` and `continue` that target a loop outside the `for try` body; which `ForBinding`s are allowed (VIP-20 shows `const row`); and what an operand that is not a Stream does (a compile error, or an AsyncIterable or Iterable consumed some other way).

## Producers

### Syntax

```text
Producer       = "effect" "function" "*" Name? TypeParameters? Params ReturnType? Block
ProducerMethod = Modifiers? "effect" "*" PropertyName TypeParameters? Params ReturnType? Block   (methods only)
```

`Modifiers` are TypeScript's class-member modifiers (`static`, `public`, `private`, `protected`, `override`), as for an `async` method. The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript; at top level it could parse as multiplication. A plain `function*` stays a JavaScript generator.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `return value` in a producer (a bare `return` is allowed and ends the stream) | code pending |

### Meaning

`effect function*` returns a Stream, as `async function*` returns an AsyncIterable. `yield x` emits `x`, and `try` runs Effects. It compiles to `Stream.callback` with one element of buffer, so the producer may run up to two elements ahead of its consumer: one in the buffer and one waiting to be offered (VIP-21, corrected). Exact pull semantics are not provided. `yield x` evaluates to `undefined`, as in an `async function*` consumed by `for await`: it is `(yield* Queue.offer(queue, x), undefined)`. A failure run by `try` in the body fails the stream. The return type, when written, is `Stream.Stream<A, E, R>`.

```vibe es
// compiler-gap: pending VIP-21
effect function* ticks() {
  yield 1
  try sleep("1 second")
  yield 2
}
effect function consume() { for try (const t of ticks()) { try log(t) } }
```

```ts effect
// fragment
function ticks() {
  return Stream.callback<number>((queue) => Effect.gen(function* () {
    yield* Queue.offer(queue, 1)
    yield* Effect.sleep("1 second")
    yield* Queue.offer(queue, 2)
  }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })
}
```

**Undecided (pending VIP):** what `yield*` (delegation) means in a producer.

## Interruption blocks

### Syntax

```text
Uninterruptible = "uninterruptible" Block
Restore         = "restore" Block
Interruptible   = "interruptible" Block
```

These are contextual keywords followed by `{` on the same line, and they are statements in effect code.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| any of the three outside effect code | code pending |
| `restore { }` outside an `uninterruptible` block | EK2111 |

### Meaning

```vibe es
// compiler-gap: pending VIP-22
effect function pay(card: Card, user: User) {
  uninterruptible {
    const receipt = try charge(card)
    restore { try notify(user) }        // the interruptibility from before the mask
    try record(receipt)
  }
  interruptible { try poll() }
}
```

```ts effect
// fragment
function pay(card: Card, user: User) {
  return Effect.gen(function* () {
    yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
      const receipt = yield* charge(card)
      yield* restore(Effect.gen(function* () { yield* notify(user) }))
      yield* record(receipt)
    }))
    yield* Effect.interruptible(Effect.gen(function* () { yield* poll() }))
  })
}
```

The keywords remove the globals of the same name ([VIP-6](../vips/0006-effect-globals.md)), so Effect's functions are written `Effect.uninterruptible` and `Effect.interruptible`.

### Leaving a block

These are ordinary blocks: `return`, `break` and `continue` inside them reach the enclosing function or loop, as in any TypeScript block (VIP-22, amended). The same holds for `provide` blocks (VIP-12, amended). `for concurrent` and `for try` keep their own rules, because their bodies run once per item.

The block's body is a separate generator, so a jump to a target outside it can't be written there. It ends the generator with a completion record instead, and the code where the block stands carries out the jump:

```vibe es
// compiler-gap: pending VIP-12
effect function find(ids: string[]) {
  outer: for (const id of ids) {
    provide Users = testUsers {
      if (id === "skip") continue outer
      if (id === "stop") break outer
      if (try (try Users).has(id)) return id
    }
  }
  return "none"
}
```

```ts effect
// fragment
function find(ids: string[]) {
  return Effect.gen(function* () {
    outer: for (const id of ids) {
      const $c = yield* Effect.provide(Effect.gen(function* () {
        if (id === "skip") return { _tag: "Continue", label: "outer" } as const
        if (id === "stop") return { _tag: "Break", label: "outer" } as const
        if (yield* (yield* Users).has(id)) return { _tag: "Return", value: id } as const
        return { _tag: "Normal" } as const
      }), [Layer.succeed(Users, testUsers)])
      if ($c._tag === "Return") return $c.value
      if ($c._tag === "Break") break outer
      if ($c._tag === "Continue") continue outer
    }
    return "none"
  })
}
```

- The records are `Normal`, `Return(value)`, `Break(label)` and `Continue(label)`, under fresh names. Each jump's target is resolved on the source, as in JavaScript: an unlabeled `break` targets the innermost enclosing loop or `switch`, an unlabeled `continue` the innermost enclosing loop, a labeled `break` its labeled statement, which may be a block, and a labeled `continue` its labeled loop. The record names that statement; the dispatch code gives it a fresh label if it has none.
- `return e` evaluates `e` once, inside the block.
- A jump whose target is inside the block stays as written.
- Nested blocks pass a record outward the same way, until it reaches the block that encloses its target.
- Only a completed block gives a record. A failure, defect or interruption stays in Effect's `Cause`. The block's own finalizers, such as releasing a `provide`'s layers, run before the jump, because `Effect.provide` and the masks complete before `yield*` returns.
- A `var` declared in the block belongs to the enclosing function, as in any block. The declaration moves to the enclosing generator, and the block keeps an assignment at the original position; a `var` with no initializer leaves nothing there. `let`, `const` and function declarations stay block-scoped.
- `this`, `arguments`, `super` and `new.target` in the block are the enclosing function's, passed in as for an `effect` block ([Functions](001-functions.md#meaning)).

```vibe es
// compiler-gap: pending VIP-22
effect function f(xs: number[]) {
  var n = 0
  for (const x of xs) {
    switch (x) { case 1: uninterruptible { var n = n + 10; break } }   // leaves the switch
    n++
  }
  return n                                      // [1, 2] gives 12
}
```

```ts effect
// fragment
function f(xs: number[]) {
  return Effect.gen(function* () {
    var n = 0
    for (const x of xs) {
      $s: switch (x) {
        case 1: {
          const $c = yield* Effect.uninterruptible(Effect.gen(function* () {
            n = n + 10
            return { _tag: "Break", label: "$s" } as const
          }))
          if ($c._tag === "Break") break $s
        }
      }
      n++
    }
    return n
  })
}
```

**Undecided (pending VIP):** whether `restore` reaches into an `effect` arrow or `effect` block nested inside the `uninterruptible` block.

## The pipe operator

`|>` is exactly TC39's Hack pipe operator, pinned to a dated snapshot of the proposal. `%` is the topic: the left side's value, evaluated once. The topic-versus-modulo grammar is TC39's, unchanged.

```vibe es
// compiler-gap: pending VIP-23
effect function run(id: string) {
  const n = fetchUser(id) |> retry(%, policy) |> timeout(%, "1 second")
  return try n
}
```

```ts effect
// fragment
function run(id: string) {
  return Effect.gen(function* () {
    const t1 = fetchUser(id); const t2 = Effect.retry(t1, policy); const n = Effect.timeout(t2, "1 second")
    return yield* n
  })
}
```

Effect's `pipe(x, f, g)` function stays available ([VIP-14](../vips/0014-effect-modules-in-scope.md)).

**Undecided (pending VIP):** the date of the TC39 pipe-operator snapshot VibeLang pins.
