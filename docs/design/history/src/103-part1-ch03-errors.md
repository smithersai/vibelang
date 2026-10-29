### 3. Errors: the E channel

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

#### Throwing a typed error

Errors are the tagged error classes you use today. `error InvalidId { raw: string }` is short for `class InvalidId extends TaggedError("InvalidId")<{ readonly raw: string }> {}`; `TaggedError`, Effect's `Data.TaggedError`, is in scope in every `.vibe` file. The tag is the class name, every field is readonly, and `error Timeout` declares an error without fields (D126). Errors that must be serialized use `schema error` (D279). In an Effect function, `throw` adds the error to E.

```ts effect
class InvalidId extends Data.TaggedError("InvalidId")<{ readonly raw: string }> {}

const parseId = Effect.fn("parseId")(function* (raw: string) {
  if (!/^\d+$/.test(raw)) return yield* new InvalidId({ raw })
  return Number(raw)
})
```

```ts es
error InvalidId { raw: string }

function parseId(raw: string) {
  if (!/^\d+$/.test(raw)) throw new InvalidId({ raw })
  return Number(raw)
}
// number!InvalidId!
```

Callee errors flow up the same way: a function's E is everything it throws plus everything its callees can fail with, minus what it catches.

In an Effect function you can throw any value; it joins E with its static type, as with `Effect.fail`: `throw new Error("bad")` adds `Error`, and `throw "bad"` adds `string`. `throw` always fails with the value it is given, so throwing a value whose type is a `Cause` is EK2140: to fail with every reason a cause holds, call `Effect.failCause(cause)`, as Effect code does (Chapter 17, D406). Tagged error classes are the convention because `catch` tells them apart with `instanceof` or `_tag`.

#### Error classes and families

An `error` declaration is a class with full class semantics: it may declare a constructor, methods, accessors, and statics, and it may extend another error (D278). A **family** is an error class and every error that extends it, directly or through other errors. Two rules govern a family:

- **Each class carries its own tag.** A base whose subclasses carry their own tags declares its tag type with a field named `_tag` (D304): `error AppError { _tag: string; code: string }`. Each instance's tag is its own class's name. An `abstract error` has no instances of its own. A subclass may be declared in any file, as with any class, so a family whose base has a `_tag` typed `string`, or is abstract, is **open**: no file lists all of its members (D345). A `match` over such a base needs `default` (below).
- **A subclass sets its own fields** (D347). A subclass that declares fields and no constructor takes one object holding its base's fields and its own. Its generated constructor's parameter has the base constructor's parameter type, with the type arguments the subclass gives its base, plus the subclass's own fields. The constructor passes that object to the base's constructor, then sets each of its own declared fields that the object has, in declaration order, reading each once, as TypeScript initializes a subclass's fields after `super()` returns. A base constructor that rebuilds its argument therefore cannot lose the subclass's fields. A subclass whose base's constructor takes anything but one object of fields is EK2118: write its constructor. A subclass that writes its own constructor sets its own fields.

```ts es
error AppError {
  _tag: string
  code: string
  constructor(args: { code: string }) {
    super({ code: args.code.trim() })        // rebuilds the object: only code reaches TaggedError
  }
}

error Throttled extends AppError { retryAfter: number }

function demo() {
  const e = new Throttled({ code: " 429 ", retryAfter: 5 })
  return [e._tag, e.code, e.retryAfter]      // ["Throttled", "429", 5]
}
```

#### Catching

`try`/`catch` handles typed errors. The caught value's type is exactly the errors the `try` block can produce.

```ts effect
const lookup = Effect.fn("lookup")(function* (raw: string) {
  const id = yield* parseId(raw)
  const users = yield* Users
  return yield* users.find(String(id)).pipe(
    Effect.catchTag("UserNotFound", () => Effect.succeed(guest))
  )
})
```

```ts es
function lookup(raw: string) {
  const id = parseId(raw)
  try {
    return Users.find(String(id))
  } catch (e) {                // e: UserNotFound
    return guest
  }
}
// User!InvalidId!Users
```

To handle some errors and pass on the rest, catch the failure and test it with pattern matching (D216); `default: throw e` passes on the rest with their types:

```ts es
function lookupOrGuest(raw: string) {
  try {
    return Users.find(String(parseId(raw)))
  } catch (e) {
    return match (e) {
      when UserNotFound: guest;
      default: throw e;
    }
  }
}
// User!InvalidId!Users
```

An arm names an error class, or several with `or`, and tests for instances, so it also matches tagged errors from other packages, such as `Schema.SchemaError`. A `match` without `default` must handle every failure the `try` block can raise (EK4701, below), so a complete match needs no rethrow. As a statement, `if (e is UserNotFound) { ... }` tests one class, and TypeScript narrows `e` after it. The earlier catch clause that names a type, `catch (e: UserNotFound)` (D131), still compiles but is retired: it draws warning EK2112, whose quick fix writes the `match`.

The catch binding may be a pattern, `catch ({ id })`. The pattern runs after the catch has recovered the failure, so what its defaults can fail with is not handled by the same catch: it joins the function's E (Chapter 17's catch rule).

#### Catching in an expression

`catch` also works after an expression (D236), like Zig's inline catch. `x catch fallback` runs `x` and, after an expected failure, evaluates the fallback instead, like `Effect.orElseSucceed`. `x catch (e) => handler` passes the expected failure to the handler, like `Effect.catch`:

```ts es
function nameOrGuest(id: string) {
  return Users.find(id).name catch "guest"
}
// string!!Users

function nameOrReason(raw: string) {
  return Users.find(String(parseId(raw))).name catch (e) => match (e) {
    when UserNotFound: "guest";
    when InvalidId: "invalid id";
  }
}
// string!!Users
```

The left side runs inside the catch, as a `try` block does; the fallback runs only when it fails. Both sides take the expression's contextual type, as the branches of `? :` do (D293). Defects and interrupts pass through, as with the statement. The value is the left side's or the handler's, and E is what the fallback or handler lets escape: the `match` above handles every failure, so none escapes; `default: throw e` would pass on the rest. `catch` binds looser than `??` and `||`, tighter than `? :` and assignment, and associates left, so `a() catch b() catch c` tries each in turn (D237). Effect's combinators still work and take a program, written `() =>`: `Effect.catchTag(() => Users.find(id), "UserNotFound", () => guest)`.

#### Promising that nothing escapes

A contract with `never` in E promises every error is handled inside, and the compiler checks it.

```ts es
export function safeLookup(raw: string): User!!Users {
  try {
    return lookupOrGuest(raw)
  } catch (e) {                // e: InvalidId
    return guest
  }
}
```

Without the `try`, you get Chapter 2's error, `EK2001: InvalidId can escape safeLookup`. The promise covers expected failures, not crashes: E bounds the `Fail` reasons that can leave a function, and defects and interruption are outside it (Chapter 17's E guarantee).

#### Cleanup with `finally`

`finally` runs when the block exits in any way: success, failure, or interruption.

```ts effect
const report = Effect.fn("report")(
  function* (id: string) {
    const reports = yield* Reports
    return yield* reports.build(id)
  },
  Effect.ensuring(Metrics.use((metrics) => metrics.increment("reports")))
)
```

```ts es
function report(id: string) {
  try {
    return Reports.build(id)
  } finally {
    Metrics.increment("reports")
  }
}
```

A `finally` that fails while the block is already failing adds its failure to the cause; it never replaces the block's failure, as `Effect.ensuring` and `Effect.onExit` never do. Unlike JavaScript's `finally`, this holds in every function, including one that compiles to plain JavaScript (Chapter 17's finalization rule). A `return`, `break`, or `continue` that leaves a `finally` block is EK2006.

For cleanup that acquires and releases a resource, use `using` (Chapter 6).

#### Failures, defects, and interruption

Effect distinguishes three ways a computation can stop, and VibeLang keeps them apart:

```ts es
function lookupAudited(id: string) {
  try {
    try {
      return Users.find(id)             // fails with UserNotFound
    } finally {
      Audit.flush()                     // and this crashes with a TypeError: a defect
    }
  } catch (e) {                         // does not run: the exit also carries a defect
    return guest
  }
}
```

`catch` handles an expected failure only when nothing else went wrong. Here the exit carries both the `UserNotFound` and the crash, so the `UserNotFound` becomes a defect of the same error (D305), the `catch` block does not run, and the whole failure propagates, crash included. `Effect.catch` does the same on Effect 4.0.6.

| What happened | Example | In E? | Caught by `catch`? | Runs `finally`? |
| --- | --- | --- | --- | --- |
| Expected failure | `throw new InvalidId(…)`, a callee's E | Yes | Yes | Yes |
| Defect: a bug | `(undefined as any).name` throws a `TypeError` | No | No | Yes |
| Interruption | a timeout, a cancelled request, a parent shutdown | No | No | Yes |
| An expected failure plus a defect | `lookupAudited` above | No: the failure becomes a defect (D305) | No: the whole exit propagates | Yes |
| An expected failure plus an interruption | a joined fiber, interrupted while its cleanup failed | Yes | Yes: `e` is the first, and the interruption is dropped (D306) | Yes |
| Several expected failures | a `finally` that threw while its block was failing; both branches of `Effect.race` failed | Yes | Yes: `e` is the first | Yes |

`catch` does not catch bugs or cancellation, because that would hide them. Handle defects deliberately with Effect's tools at a boundary: `Effect.catchDefect(() => risky(), …)`. To declare an expected failure impossible here, make it a defect: `const id = Effect.orDie(() => parseId(raw))`. To see every failure in an exit, use `Effect.catchCause` or `exit`. Chapter 17 states the full rules.

#### Coming from `Effect.gen`

Two forms look the same but mean different things, on purpose.

**`throw` is `Effect.fail`.** Inside `Effect.gen`, `throw new Error("unreachable")` is a defect. In an Effect function, `throw` is a typed failure: `Error` joins E, and a `catch` can handle it. To signal a bug, die explicitly: `Effect.die(new Error("unreachable"))`.

**Effect `catch` sees expected failures only.** Inside `Effect.gen`, a JavaScript `catch` sees any synchronous exception from its `try`. In an Effect region, an exception no contract lists is a defect, and `catch` does not see it. That covers Effect's "cannot fail here" functions, such as `Option.getOrThrow` and `Schema.decodeUnknownSync`, whose exceptions are defects (Chapter 10); each has a form for code that can fail: `Option.getOrElse`, `Effect.fromOption`, `Schema.decodeUnknownEffect`. A function with a plain return annotation follows the same rule, because a plain function never fails (D282): its catch receives typed failures only. A catch whose try block has E = `never` reports EK2004, a warning by default; defects pass through it:

```ts es
function firstAdmin(users: ReadonlyArray<User>) {
  try {
    Effect.succeed(undefined)
    return Option.fromNullishOr(users.find(isAdmin)).getOrThrow()
  } catch (e) {
    return guest
  }
}
```

```text
warning EK2004: This try block runs Effects but has no expected errors; defects pass through this catch.
  admins.vibe:4:12   return Option.fromNullishOr(users.find(isAdmin)).getOrThrow()
                                                                      ^^^^^^^^^^^^ its exceptions are defects
  Use a form that can fail:   return users.find(isAdmin) ?? guest
  or bound the call:          try(…, (cause) => new NoAdmin({ cause }))
```

#### Failing in an expression

`throw` also works as an expression (D186), as in the TC39 [throw expressions](https://github.com/tc39/proposal-throw-expressions) proposal. It fails exactly as the statement does and has type `never`:

```ts
error NoAdmin

function admin(users: ReadonlyArray<{ admin: boolean; name: string }>) {
  return users.find((user) => user.admin)?.name ?? throw new NoAdmin()
}
// string!NoAdmin!
```

Its operand is a unary expression, as in the proposal's grammar, so an operator after it applies to more than the throw. EK1010 refuses a throw that is, or ends, a binary operator's left operand (except comma), a conditional's condition, or the operand of `as` or `satisfies`: `x ?? throw c ? a : b` is `(x ?? throw c) ? a : b` and throws only `c`. Write `x ?? throw (c ? a : b)`. A parameter default runs where no failure can be raised, so a throw expression there is EK1001, as any failing default is: compute the value in the body (D350).

#### Matching errors and outcomes

`match` and `is` come from the TC39 [pattern matching](https://github.com/tc39/proposal-pattern-matching) proposal (D206, D211). An `error` class is a pattern that matches its own instances and its subclasses', by the tag its type declares, as `catchTag` does (D215, D515), and `Option`, `Exit`, and `Result` have matchers that bind their contents (D208). A pattern's names resolve as any reference does, so these built-in matchers apply only where the name resolves to Effect's module; a local `Option` or `Number` is an ordinary matcher (D328, D367):

```ts es
function describe(failure: NotFound | Timeout) {
  return match (failure) {
    when NotFound and { let id }: `no user ${id}`;
    when Timeout: "retry";
  }
}

function firstFailure(id: string) {
  const outcome = exit(() => getUser(id))
  if (outcome is Exit.Failure(let cause) && Cause.hasFails(cause)) return Cause.pretty(cause)
  return "ok"
}
```

A data type's variant is a pattern too (D307, Chapter 11): `when Delivery.Sent { let tracking }` tests the tag and binds the fields its braces list.

A matcher means what its name resolves to (D213). `when String` tests `typeof` because `String` is the global `String`, and `when Option.None` tests `Option.isNone` because `Option` is effect's module; a parameter named `String` is a variable pattern like any other name, and a data type named `Option` has its own `Option.None`.

The parser writes both as conditionals TypeScript narrows, so each arm sees its own type and can call Effect functions (D214). Each reads its subject once, before any pattern, as `switch` reads its discriminant, and each property of it, and each iterator step, at most once (Chapter 26 states the order, D368). The same `match` handles a propagating failure, inside `catch (e)`, and a failure or Exit held as a value. An object pattern matches only an object, a value whose `typeof` is `"object"` or `"function"` and that is not `null`, and reads no property of a primitive [Rule] (D441).

**Exhaustiveness** (D346). A `match` without `default` must cover its subject, or it is EK4701. It can cover only a subject whose declared type is a finite union of concrete cases: literal types, `boolean`, `null`, `undefined`, and `void`; a `data` type or its variants; `Option`, `Exit`, `Result`, and their cases; and **tagged classes**, whose instance type declares `_tag` as a string literal or a union of them, such as an `error` without a `_tag` field (below, D515). The compiler removes what each arm matches from that union, as TypeScript narrows it: a literal arm removes its literal; a data variant, or a case of `Option`, `Exit`, or `Result`, removes that case; a class arm over a tagged class removes every case whose `_tag` type its tag set covers, its class and every class below it among them; an arm that only binds, `when let x:`, removes everything, as `default` does (D471). An arm whose pattern contains a guard anywhere, `when X and if (…)`, `when 1 or if (flag)`, or `when not if (…)`, removes nothing, because a guard can fail; a guard reads only the bindings of the terms tested before it, left to right and depth first, and a reference to one that a later term binds is EK4704 (D502, D520). What is left after the last arm must be `never`, and EK4701 names what is left.

**Tagged classes** [Rule] (D515). A class arm can remove a type from the subject only if its test accepts every value of that type, and TypeScript's types are structural: another declaration's class with the same tag and fields is assignable to an `error` class, as in Effect TypeScript (D501), and fails its `instanceof`. So a class arm over an error class tests what its type guarantees, the tag, as Effect's `catchTag` and `Match.tag` do. A **tagged class** is a class whose instance type declares `_tag` as a string literal or a union of string literals: every `error` declaration with a literal tag, every `Data.TaggedError`, `Data.TaggedClass`, and `Schema.TaggedError` class, and `effect`'s own tagged error classes, such as `NoSuchElementError` and `TimeoutError`. Its **tag set** is that literal or union. A base whose subclasses carry their own tags lists them, since a subclass whose name its base's tag type does not include is EK2117, so the tag set covers the class and every class below it.

- *Trigger.* A class arm, `when C:`, `when C and …`, or `x is C`, whose `C` resolves to a tagged class that declares no `[customMatcher]` of its own, from source and from declarations alike.
- *Static check.* The arm removes from the subject every case whose `_tag` type is within `C`'s tag set, as TypeScript narrows a union by `e._tag`, and the arm sees the subject narrowed so.
- *Runtime.* Where the subject's declared type has a case whose `_tag` type is within the tag set, the arm matches a value that is an object (D441) whose `_tag`, read once (D368), is a member of the tag set; no `instanceof` test runs, and `C(let e)` binds the value itself. Where it has none, as for a subject typed `unknown`, `any`, or `object`, nothing typed vouches for a tag, so the arm tests `instanceof`, as D213 does, and removes nothing. A value of a same-shaped class of another declaration, or of a second installed copy of the class's package, has that tag and takes the arm, as it takes `catchTag`'s. Every arm's test still runs (D405), so the end of an exhaustive match over tagged classes is reached only by a value outside its declared type, which only a cast or `any` can make, and that is a defect.

```ts es
// left.vibe and right.vibe each declare:  export error Missing { id: string }
import { Missing as LeftMissing } from "./left.js"
import { Missing as RightMissing } from "./right.js"

function explain(e: LeftMissing): string {
  return match (e) {
    when LeftMissing: "missing";              // tests e._tag === "Missing": exhaustive, no default
  }
}

const said = explain(new RightMissing({ id: "42" }))   // "missing": TypeScript accepts the argument, and the tag matches
```

A class arm over any other class, one whose `_tag` is typed `string`, as an open family's base is, an `abstract error`, `Error`, a class with no `_tag`, or a class that declares its own `[customMatcher]`, tests that matcher or `instanceof` (D213) and removes nothing, as a guarded arm does, since a value of its type need not pass that test. Error classes keep full class semantics (D278); only an arm's test and the credit it gets toward exhaustiveness depend on this. So a union of `Data.TaggedError` classes that a `.ts` file declares, such as `UserNotFound | DbError` of Chapter 10's `findUser`, is covered by an arm for each, and a match over it needs no `default`, as is `match (e._tag) { when "UserNotFound": …; when "DbError": … }`, which tests the same field.

Every other subject is **open**, and a `match` over it needs `default`, or an arm that matches every value: an open family's base (an `error` whose `_tag` is typed `string`, or an `abstract error`), another class that code anywhere may extend, such as `Error`, a class that is not tagged, `unknown`, `any`, `object`, a type parameter, and a `string` or `number` without a literal type, such as a `_tag` typed `string` matched by tag literals. An arm that names an open family's `error` base, or `Error`, tests `instanceof` and removes nothing, since a value of its type need not pass that test (D428, D515); `default`, or an arm that only binds, `when let e:`, covers the rest. Arms that name only an open family's subclasses never cover it, because another file may declare one more. EK4701 names the open type and offers two fixes: add `default`, or narrow the subject's declared type to the union of concrete classes the match handles. A function whose callers should handle its failures exhaustively declares that union as its E, as Effect users write `Effect<number, Denied | Busy>`.

```ts es
error PaymentError { _tag: string; code: string }
error Declined extends PaymentError { reason: string }
error Expired extends PaymentError {}

function message(e: PaymentError) {
  return match (e) {
    when Declined: "declined";
    when Expired: "expired";
  }
}
```

```text
error EK4701: This match has no default, but PaymentError is an open family: any file may extend it.
  payments.vibe:6:10   return match (e) {
  Add a default arm:                      default: "payment failed";
  or narrow the subject to what you handle:   function message(e: Declined | Expired)
```

With `e: Declined | Expired`, both classes have literal tags, the two arms remove both, and the match needs no `default`. A function that throws only these declares `number!Declined | Expired`, and a `catch` around its call checks the same way.

Inside `catch (e)`, the subject is the try block's expected failures, and the same law applies; there the quick fix for EK4701 writes `default: throw e`, which passes the rest on with their types. A class pattern still tests at run time, a tagged class's tag and any other class's custom matcher or `instanceof` (D213, D515): a value outside its declared type, which only a cast or `any` can make, fails the match with the proposal's `TypeError`, a defect. Every arm's test runs when its arm is reached, the last arm of an exhaustive match included, with its property reads and matcher expressions, and a last arm whose test fails is a defect, never a silent match (D405). No type proves a test inert: a literal-typed field, a data value's `_tag` included, may be a getter, and proving coverage proves nothing about what a test does.
