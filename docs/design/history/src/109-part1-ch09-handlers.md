### 9. Handlers: defining your own effects

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

#### What a service cannot do

A service call returns to the caller exactly once, with a value or an error. That covers most dependencies, but not cases where whoever handles the request should decide *whether and when the caller continues*:

- pause a checkout until a person approves it, and let the approver's code decide what happens next;
- stop a search as soon as one result is found, cleaning up everything the search had opened;
- let a test script the answers to a sequence of requests, one at a time;
- run a producer one value at a time (Chapter 8).

A **control operation** is a request whose handler receives the rest of the caller's computation and decides what to do with it.

#### Declaring and performing an operation

Declare a control operation like a service, with `control`, short for an abstract class that extends the global `Control` (D128):

```ts es
control Approval {
  approve(request: string): boolean!ReviewBusy
}

function checkout(cartId: string) {
  using hold = Inventory.reserve(cartId)
  const ok = Approval.approve(`charge cart ${cartId}`)
  if (!ok) throw new Declined({ cartId })
  return Payments.charge(cartId)
}
// Receipt!ReviewBusy | Declined | PaymentError!Approval | Inventory | Payments
```

To the code that performs it, `Approval.approve` is an ordinary call. Like a service, `Approval` stays in R until something handles it, and the service rules apply: its members are abstract with full contracts, its key derives from its module, and it cannot be extended or instantiated.

#### Handling it

A `handle` clause after a try block answers an operation the block performs. It names the operation and its parameters, which take the operation's parameter types. `resume(value)` continues the block from the call with that value.

```ts es
function reviewedCheckout(cartId: string) {
  try {
    return checkout(cartId)
  } handle Approval.approve(request) {
    const decision = Reviewers.decide(request)    // may take minutes: the fiber just waits
    resume(decision)                              // checkout continues from its call
  }
}
// Receipt!ReviewBusy | Declined | PaymentError!Inventory | Payments | Reviewers
```

While the reviewer decides, the cart's hold stays reserved and `checkout` waits at its call, as during any slow service call. A clause that ends by resuming, like this one, costs no stack: the compiler ends the clause before it continues the program (Chapter 26), so a handler that resumes a million times runs in constant space.

The try block and the clauses are code of the enclosing function (D132): a `return` in either returns from the function, and `break` and `continue` leave its loops. A clause can work after `resume`, which returns when the try block finishes; when the clause then ends, the statement ends as the block did, so the block's `return` takes effect after the clause, as a pending `return` waits for a `finally` block. That `resume` returns the value the statement ends with; its type is the handler's answer type (below). A statement answers every operation of each control it names (EK2108). Catch clauses and a `finally` block may follow its handle clauses and cover both the block and the clauses.

#### Answer types

A handler is deep: a resumed program runs until it ends or reaches the handler again, and whatever the handled code ends with there is what `resume` returns. Every `resume` of one handler therefore has one type, the handler's **answer type** H: the type of every value the handled code can end with (D351). The compiler checks every value against that one H, never against a narrower type, so a `resume` never delivers a value outside its type. This is the typing rule of Eff and OCaml 5, where a continuation's result is the handler's answer type.

For a handle statement, the compiler computes H in one step, without a fixpoint. H is the type of what the try block and each clause return, plus `undefined` only when the block, or a clause that has not resumed, can complete normally or by a `break` or `continue` that leaves the handle statement, rather than by returning; a `throw` adds nothing, since a failure gives `resume` no value (D467, D487); a clause's `return` that some path through the clause reaches after a non-tail `resume` call of that clause is left out, because its type may depend on H (D410). Which returns are left out is read from the clause's control flow, not from what they compute. The compiler then checks each return it left out against H. If every one is within H, H is sound. If one is not, the program is EK2119, an error: the type that clause's `resume` was given would not cover the value. Write the enclosing function's success type; then H is the written type, plus `undefined` under the same condition, and every return of the try block and the clauses is checked against it:

```ts es
control Step { next(): void!! }

function run(): number | string!! {
  try {
    Step.next()
    Step.next()
    return 1
  } handle Step.next() {
    const n = resume()                   // n: number | string
    return typeof n === "number" ? n.toFixed(1) : "done"
  }
}
```

Here the try block always returns and the clause always resumes before it returns, so `undefined` is not added. Without `: number | string!!`, H would be `number`, the try block's return, since the clause's return follows a non-tail `resume` and is left out; yet the inner clause's string return is what the outer clause's `resume` receives. The compiler reports EK2119 rather than give `n` a type its value can leave; a clause that called `n.toFixed(1)` unguarded would otherwise fail at run time with a `TypeError`.

For the `handle` function below, TypeScript fixes H before it checks the clauses, so H is the program's result type, or `never` with `onReturn`. A clause that reads a non-tail `resume`'s result while a clause or `onReturn` can produce a value outside H is EK2110. Read such results in a handle statement, whose H can be written.

The statement is short for `handle`, a function that runs a program and returns its result. Each clause receives `k`, the rest of the program from the point of the call, and `resume(k, value)` continues it:

```ts es
const receipt = handle(() => checkout("c-42"), Approval, {
  approve(request, k) {
    const decision = Reviewers.decide(request)
    return resume(k, decision)
  }
})
// receipt: Receipt
```

`resume` returns what the rest of `checkout` returned, here the `Receipt`.

#### Not continuing

A handler that returns without calling `resume` ends the handled program with the handler's result.

```ts es
control Found {
  found(cell: Cell): never!!
}

function locate(grid: Grid, target: number) {
  try {
    for (const row of grid.rows) {
      using cursor = grid.open(row)
      for (const cell of cursor.cells) if (cell.value === target) Found.found(cell)
    }
    return undefined
  } handle Found.found(cell) {
    return cell      // stop: the open cursor is released before locate returns
  }
}
// Cell | undefined!!
```

`found`'s result type is `never`, so the type says its handler cannot continue the search.

#### Continuing with an error

`resumeWith` continues the program by running code at the call, where the program may catch what it throws:

```ts es
function patientCheckout(cartId: string) {
  try {
    return checkout(cartId)
  } handle Approval.approve(request) {
    if (Reviewers.busy()) resumeWith(() => { throw new ReviewBusy({ request }) })
    else resume(Reviewers.decide(request))
  }
}
```

Code passed to `resumeWith` runs inside the handled program, so two rules keep its contract honest:

- It may throw only the operation's declared errors (`ReviewBusy` here), which every caller of `Approval.approve` already sees in E.
- It may need no service: the providers around the clause are not in scope at the call, so its R must be `never`.

```text
error EK2005: resumeWith runs this code at the perform site, inside the handled program,
  where the clause's providers are not in scope. It needs Secret.
  approvals.vibe:4:16   resumeWith(() => Secret.read())
  Read it in the clause first:   const secret = Secret.read()   …   resumeWith(() => secret)
```

#### Testing with a handler

```ts es
it.effect("checkout charges when approved") {
  try {
    assert.isTrue(checkout("c-42").paid)
  } handle Approval.approve(_request) {
    resume(true)
  }
}
```

#### The full API

`try { … } handle Control.operation(parameters) { … }` handles the operations of the controls its clauses name, the first control's handler innermost. In a clause, `resume(value)`, `resumeWith(() => …)`, and `abandon()`, the three calls below without `k`, act on the clause's continuation; `resume()` continues an operation whose result is `void`. The compiler writes the statement as a call of `handle` whose program and clauses return the statement's completion: a `return`, `break`, or `continue`, or normal completion (Chapter 26).

`handle(program, Operations, clauses, onReturn?)` runs `program` with a handler for `Operations`; the optional `onReturn` transforms the program's own result before `handle` returns it. In a clause, `k` has type `Continuation<V, E, H>`: `V` is what the call receives, `E` the operation's declared errors, which only `resumeWith` may raise, and `H` the answer type. `resume(k, v)` returns an `H`: the handler is deep, so the resumed program runs until it reaches the handler again, where `onReturn`, or a later clause that does not resume, produces the value. As above, `H` is the program's own result type, or `never` with `onReturn`, and EK2110 rejects a clause that reads a non-tail `resume`'s result where the handle can produce a value outside `H`. Three operations take `k`:

| Call | Meaning |
| --- | --- |
| `resume(k, value)` | Continue with `value` as the operation's result; returns an `H`, what the `handle` produces when the program next reaches it |
| `resumeWith(k, () => …)` | Continue by running the given code at the call; it may throw only the operation's declared errors, and its R is `never` |
| `abandon(k)` | Stop the program now: its cleanup runs, its `catch` blocks do not; fails if cleanup fails |

The standard library uses a fourth operation, `transfer`, which hands a continuation to a scope so it can be resumed after the clause returns; producers' external iteration needs it. v0 keeps it inside the standard library (Chapter 21).

#### The rules

- **Continue at most once.** Calling `resume(k, …)` twice is an error at the second call; nothing in the program runs twice.
- **Not continuing cleans up.** If the handler returns, fails, or is interrupted without resuming, the program's `using` and `finally` blocks run before `handle` returns.
- **`k` stays inside the clause** (D410). In a clause of a `handle(...)` call, `k` may appear only as the first argument of `resume`, `resumeWith`, or `abandon`, written in the clause's own body and not in a function nested in it; any other use, such as storing it, returning it, passing it elsewhere, or capturing it, is EK2128. A handle statement's clause never names its continuation: it calls `resume`, `resumeWith`, and `abandon` in its own code, and one written in a function nested in it, or in a form of rule D that runs its body on another fiber or later, `fork`, an await operation's element, a block param, or a `for concurrent` body, is EK2128 too (D455). The same holds for a `resume`, `resumeWith`, or `abandon` of `k` in such a form inside a clause of a `handle(...)` call. The clauses argument of `handle(...)` is an object literal, so every clause is written where these checks see it; any other clauses argument is EK2128 (D440).
- **One answer type.** Every `resume` of a handler has the handler's answer type, and every value the handled code can end with is checked against it (EK2110, EK2119).
- **Handlers belong to a fiber.** A program forked onto another fiber cannot reach a handler on this one; the next section shows the check.
- **Cleanup code handles its own operations.** A `finally` block or `using` release that performs a control operation must handle it inside itself, so a handler elsewhere cannot cut cleanup short.

#### Handlers and concurrency

A program that runs on other fibers must handle its own control operations. The compiler checks every Effect combinator that runs its argument elsewhere (Chapter 16):

```ts es
function approveAll(ids: ReadonlyArray<string>) {
  return forEach(ids, (id) => Approval.approve(id), { concurrency: 4 })
}
```

```text
error EK4201: Approval.approve is a control operation, and forEach with concurrency 4 runs
  its callback on other fibers, where the Approval handler on this fiber cannot be reached.
  Handle Approval inside the callback, or run the loop with concurrency 1.
```

The fix puts a handler inside each concurrent branch:

```ts es
function approveAll(ids: ReadonlyArray<string>) {
  return forEach(ids, (id) => {
    try {
      return Approval.approve(id)
    } handle Approval.approve(request) {
      resume(Reviewers.decide(request))
    }
  }, { concurrency: 4 })
}
```

TypeScript code is checked the same way, from its signature. But a TypeScript function can fork internally without taking a program argument, where no table sees it, so in v0 VibeLang cannot call a TypeScript function whose R contains a control operation:

```text
error EK4202: retryApproval is a TypeScript function whose requirements include the control
  operation Approval. TypeScript code can perform Approval.approve on another fiber, where
  this handler cannot reach it.
  Write retryApproval in VibeLang, where the compiler sees every fork, or handle Approval inside it.
```

A VibeLang function counts as VibeLang here only when its `.vibe` source is part of the compilation, so the compiler has seen every fork in its body. A function known only from a declaration file, VibeLang's own emitted `.d.ts` included, is TypeScript code to this check, and EK4202 applies to it: a declaration states a contract, not what the body does (D352).

#### In Effect today

There is no equivalent. A service method can wait and return, but it cannot end its caller with a value or hand the caller's remaining work to someone else to continue later. Code that needs those things restructures itself around queues, `Deferred`s, and extra fibers. Part III explains how VibeLang provides this on Effect's runtime, and why everything else in this part builds on it.
