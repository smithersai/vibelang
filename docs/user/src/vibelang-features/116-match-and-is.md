# Pattern matching with `match` and `is`

`match` selects the first arm whose pattern fits a value and returns that arm's expression. `is` tests a value against one pattern and returns a boolean. Both implement the TC39 [pattern matching](https://github.com/tc39/proposal-pattern-matching) proposal, compile to plain conditionals tested in order, narrow types naturally, and allow `try` inside arms in effect code.

![Exhaustive match narrowing across tagged unions](/diagrams/match-exhaustiveness.svg)

**`match` is exhaustive.** When matching a finite union (literals, `data` variants, `error` classes, `Option`, `Exit`, `Result`, tagged objects) without a `default` arm, missing a case is compile error `EK4701`.

## `match` expressions

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([describe(new NotFound({ id: "7" })), describe(new Timeout()), describe(new Denied({ user: "Ada", reason: "admin" })), describe(new Denied({ user: "Ada", reason: "other" }))])))
error NotFound { id: string }
error Timeout
error Denied { user: string; reason: string }

type Failure = NotFound | Timeout | Denied

function describe(failure: Failure) {
  return match (failure) {
    when NotFound(let e): `no user ${e.id}`;
    when Timeout: "retry";
    when Denied and { reason: "root" or "admin" }: "denied by policy";
    when Denied: `denied ${failure.user}`;
  }
}
// Output: ["no user 7","retry","denied by policy","denied Ada"]
```

- Every arm ends with `;`, including the last (`EK0701` if omitted). `default:` must come last.
- The subject is evaluated once before the first arm. Property reads and iterable pulls are cached across arms within a single `match`.
- An arm is a single expression. For multiple statements (including `try`), use a `do { ... }` block whose last expression is the arm's value (`EK0201` if the block ends with a declaration, loop, or bare `if`):

```vibe
// run: try Console.log(try retryDelay(new Timeout())); try Console.log(try retryDelay(new NotFound({ id: "7" })))
effect function retryDelay(failure: Failure) {
  return match (failure) {
    when Timeout: do {
      try Console.log("timed out")
      "1 second"
    };
    default: "0 millis";
  }
}
// Output: timed out
// Output: 1 second
// Output: 0 millis
```

## Patterns at a glance

| Pattern | Matches | Example |
| --- | --- | --- |
| Literal | Equal string, number, boolean, `null`, `undefined` (`0` matches `±0`) | `when 404:` |
| Binding | Anything; binds with `let` or `const` (`var` is `EK0107`) | `when let other:` |
| Array / Iterable | Iterable of matching shape (`...let rest` for remainder) | `when [let first, ...let rest]:` |
| Object | Non-primitive with matching properties (`{ let id }` binds `id`) | `when { status: 200, let body }:` |
| `data` variant | Tagged object pattern (`when Delivery.Sent:` is `EK0702`) | `when { _tag: "Sent", let tracking }:` |
| Class / Error | Own `Symbol.customMatcher` (for `error`s: `_tag` then `instanceof`) or `instanceof` | `when NotFound:` |
| Extractor | Matcher values matched in parentheses | `when Option.Some(let user):` |
| Combinators | `and`, `or`, `not` (parenthesize mixed levels: `EK0707`) | `when ("a" or "e") and not "i":` |
| Guard | Arbitrary boolean expression using earlier bindings | `when [let n] and if (n > 0):` |
| Regex / Relational | Regex match/capture or `<`, `<=`, `>`, `>=`, `===`, `instanceof`, `in` | `when >= 10 and < 20:` |

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([shape([]), shape([2]), shape([2, 3, 4]), shape({ kind: "box", size: 5 }), shape({ kind: "point", size: 1 }), shape({ kind: "other" })])))
function shape(value: ReadonlyArray<number> | { kind: string; size?: number }) {
  return match (value) {
    when []: "empty";
    when [let only]: `one: ${only}`;
    when [let first, ...let rest]: `${first} then ${rest.length} more`;
    when { kind: "box", let size }: `box of ${size}`;
    when { kind: "point", ...let others }: `point with ${Object.keys(others).length} more keys`;
    default: "other";
  }
}
// Output: ["empty","one: 2","2 then 2 more","box of 5","point with 1 more keys","other"]
```

Object patterns match only objects and functions, never primitives. Template patterns with no interpolations (`` `ready` ``) match literally; an interpolated primitive pattern is `EK0707` — use a guard (`when let v and if (v === `tag-${kind}`):`) instead.

## `Option`, `Exit`, `Result`, and primitives

Built-in matchers compile directly to Effect's own brand-safe guards:

| Matcher | Extracts |
| --- | --- |
| `Option.Some(let v)`, `Option.None` | Inner value / nothing |
| `Exit.Success(let v)`, `Exit.Failure(let cause)` | Success value / `Cause` |
| `Result.Success(let v)`, `Result.Failure(let err)` | Success value / failure value |
| `String(let s)`, `Number(let n)`, `Boolean`, `BigInt`, `Symbol` | Primitive value (unboxing `new String(...)` via `valueOf()`) |

Effect 4.1.1 also retains thirty-four tagged error patterns (including `Cause.TimeoutError`, `Cause.NoSuchElementError`, `Schema.SchemaError`, `PlatformError.PlatformError`, `HttpClientError.HttpClientError`, `Csv.CsvError`, and `JoseError.JoseError`) that match by module brand guard and extract the error instance.

```vibe
// run: try Console.log(greeting(Option.some("Ada"))); try Console.log(greeting(Option.none())); try Console.log(try report("ada")); try Console.log((try report("")).includes("NotFound"))
function greeting(name: Option.Option<string>) {
  return match (name) {
    when Option.Some(let n): `Hello, ${n}`;
    when Option.None: "Hello";
  }
}

effect function report(id: string) {
  const outcome = try exit(getUser(id))
  return match (outcome) {
    when Exit.Success(let user): user.name;
    when Exit.Failure(let cause): Cause.pretty(cause);
  }
}

effect function getUser(id: string): { name: string }!NotFound!never {
  if (id === "") throw new NotFound({ id })
  return { name: "Ada" }
}
// Output: Hello, Ada
// Output: Hello
// Output: Ada
// Output: true
```

## `data` variants

Match [`data`](../data-types/073-data.md) variants with object `_tag` patterns (`when Delivery.Sent:` is `EK0702`):

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([track(Delivery.Sent({ tracking: "parcel-8" })), track(Delivery.Sent({ tracking: "parcel-9", carrier: "rail" })), track(Delivery.Waiting())]))); try Console.log(carrierOf(Delivery.Sent({ tracking: "p", carrier: "rail" })))
data Delivery {
  Waiting
  Sent { tracking: string; carrier?: string }
  Rejected { reason: string }
}

function track(delivery: Delivery) {
  return match (delivery) {
    when { _tag: "Sent", let tracking, carrier: "rail" }: `${tracking} by rail`;
    when { _tag: "Sent", let tracking }: `${tracking} by ${delivery.carrier ?? "post"}`;
    when { _tag: "Waiting" } or { _tag: "Rejected" }: "not sent";
    default: "unknown";
  }
}

function carrierOf(delivery: Delivery) {
  if (delivery is { _tag: "Sent" }) return delivery.carrier ?? "post"
  return "none"
}
// Output: ["parcel-8 by post","parcel-9 by rail","not sent"]
// Output: rail
```

## Custom matchers (`Symbol.customMatcher`)

Any object with `[Symbol.customMatcher]` works as a matcher or extractor (return `false` for no match, or an iterable of extracted values when `{ matchType: "extractor" }` is passed). Plain predicate functions work as bare matchers (`when Array.isArray:`):

```vibe
// run: try Console.log([parity(2), parity(3)].join(", "))
const Even = {
  [Symbol.customMatcher](subject: unknown) {
    return typeof subject === "number" && subject % 2 === 0
  }
}

function parity(n: number) {
  return match (n) {
    when Even: "even";
    default: "odd";
  }
}
// Output: even, odd
```

An ordinary class without its own `Symbol.customMatcher` matches via `instanceof`, so calling it as an extractor (`when MyClass(let x):`) reports `EK0704`; write `when MyClass and { x: let x }:`. Wrong extractor arity draws warning `EK0703`.

## Combining patterns and guards

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([classify({ status: "failed", attempts: 3 }), classify({ status: "failed", attempts: 1 }), classify({ status: "queued", attempts: 0 }), classify({ status: "done", attempts: 0 }), classify({ status: "cancelled", attempts: 0 })])))
function classify(job: { status: string; attempts: number }) {
  return match (job) {
    when { status: "failed", attempts: let n } and if (n >= 3): "escalate";
    when { status: "failed" }: "retry";
    when { status: not ("done" or "cancelled") }: "running";
    default: "leave";
  }
}
// Output: ["escalate","retry","running","leave","leave"]
```

## Regular expressions and relational patterns

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([size(3), size(15), size(99), size("big"), id("ab 12"), id("none")])))
function size(n: unknown): string {
  return match (n) {
    when < 10: "small";
    when >= 10 and < 20: "mid";
    when Number: "large";
    default: "not a number";
  }
}

function id(text: string): string {
  return match (text) {
    when /(?<id>\d+)/(let m): `id ${m.groups!.id}`;
    default: "none";
  }
}
// Output: ["small","mid","large","not a number","id 12","none"]
```

## Inline `is` tests

`value is pattern` returns a `boolean` and binds tightly (like `instanceof`):

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify([isRetryable(new Timeout()), isRetryable(new Denied({ user: "Ada", reason: "root" })), isRetryable(new NotFound({ id: "7" }))])))
function isRetryable(failure: Failure) {
  return failure is Timeout or Denied
}
// Output: [true,true,false]
```

Bindings introduced by `is` are available in subsequent `&&` checks and the enclosing block:

```vibe
// run: try Console.log(try firstFailure("ada")); try Console.log((try firstFailure("")).includes("NotFound"))
effect function firstFailure(id: string) {
  const outcome = try exit(getUser(id))
  if (outcome is Exit.Failure(let cause) && Cause.hasFails(cause)) {
    return Cause.pretty(cause)
  }
  return "ok"
}
// Output: ok
// Output: true
```

`is` may bind names in any expression. Bindings live in the nearest lexical block (or loop head for `for` / `while` / `do…while`, where `for` `init` bindings are copied into each iteration as a `let` declared there is, a skipped `init` binding stays in the runtime temporal dead zone, and Neither home exports the binding after the loop). An `is` binding that needs an unbraced statement body as its lexical home reports `EK0705` (add braces; parameter defaults and `enum` initializers also report `EK0705`). A collision with a local `const` also reports `TS2451`, a collision with a parameter reports `TS2300`, Both declarations are reported, and Assignments written in the source keep their ordinary type and immutability checks. A read where the pattern may not have run follows TypeScript's definite-assignment checks (`TS2454`): `any`, `unknown`, `void`, and types containing `undefined` are exempt; a read before the binding's position is `TS2448`, and an uninitialized closure read throws `ReferenceError`; a later pattern failure does not undo an earlier initialization.

## Exhaustiveness (`EK4701`)

Without `default`, `match` checks complete coverage over finite domains: literals, `boolean`, `null`, `undefined`, enums, `data` variants, `error` / `schema error` classes, `Option` / `Exit` / `Result`, retained Effect errors, and objects with literal discriminant fields (`_tag`, `kind`, `type`, etc.). Members sharing a literal `_tag` are covered by that tag pattern. A type parameter with a finite constraint is checked over that constraint (`T extends "A" | "B"`). Open types (`string`, `number`, `unknown`, `any`) skip exhaustiveness and throw `TypeError` at run time if unmatched.

```vibe
// expect-error: EK4701
type Phase = "draft" | "review" | "published"

function phaseLabel(phase: Phase) {
  return match (phase) {
    when "draft": "Draft";
    when "published": "Published";
  }
}
```

```text
error EK4701: This match does not handle every case of Phase: "review" is left.
```

```vibe
// expect-error: EK4701
data Shipment {
  Packed
  Shipped { carrier: string }
  Delivered
}

function shipmentLabel(shipment: Shipment) {
  return match (shipment) {
    when { _tag: "Packed" }: "packed";
  }
}
```

```text
error EK4701: This match does not handle every case of Shipment: Shipment.Shipped | Shipment.Delivered is left.
```

```vibe
// expect-error: EK4701
error Missing { path: string }
error Other { code: string }

function describeError(failure: Missing | Other) {
  return match (failure) {
    when Missing: failure.path;
  }
}
```

```text
error EK4701: This match does not handle every case of Missing | Other: Other is left.
```

## Async matches

Outside effect code, `async match` returns a `Promise` so its subject, tests, and arms can use native `await` (outward `return`, `break`, or `continue` reports `EK0706`):

```vibe
function load() {
  return async match (await Promise.resolve("sent")) {
    when "sent": await Promise.resolve("delivered");
    default: "other";
  }
}
```

## Diagnostics summary

| Code | Cause | Fix |
| --- | --- | --- |
| `EK0701` | Missing `;` at the end of a `match` arm | End every arm with `;`. |
| `EK0702` | Invalid matcher (e.g., `data` variant `Delivery.Sent` or non-callable value) | Match variants with `{ _tag: "Sent" }` or test in a guard. |
| `EK0703` | Extractor arity cannot match (e.g., `Option.None(let x)`) | Use the bare pattern or matching arity. |
| `EK0704` | Extractor syntax `C(...)` on a class without own `Symbol.customMatcher` | Write `when C and { field: let x }:`. |
| `EK0705` | `is` binding in an unbraced statement body, parameter default, or `enum` | Wrap the statement body in `{ ... }`. |
| `EK0706` | `return`, `break`, or `continue` leaving an `async match` | Return the arm's expression instead. |
| `EK0707` | Malformed pattern grammar (mixed `and`/`or`/`not`, interpolated template, `__proto__`) | Parenthesize combinators or use a guard. |
| `EK4701` | Non-exhaustive `match` over a finite union without `default` | Add the missing cases or a `default:` arm. |

For full specification rules on pattern caching, `do` blocks, and custom matcher protocols, see [Chapter 4 of the Specification](../../../design/src/004-match.md).
