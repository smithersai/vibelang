# Failures

Sources: [VIP-4](../vips/0004-throw.md), [VIP-13](../vips/0013-error-declarations.md), [VIP-29](../vips/0029-schema-errors.md). Handling failures with `catch` is in [Running Effects](002-running.md#catch), and matching them is in [Pattern matching](004-match.md).

## `throw`

### Meaning

`throw` is allowed everywhere. `Promise.reject(e)`, like every Promise-producing call, must be inside a `tryPromise` or `promise` thunk in effect code.

| Where | `throw e` means |
| --- | --- |
| a plain or `async` function, or the top level | JavaScript's `throw` |
| effect code | the Effect fails with `e`, a typed error: `yield* Effect.fail(e)` |

```vibe es
// compiler-gap: pending VIP-4
effect function load(id: string) {
  const user = try findUser(id)
  if (!user) throw new NotFound({ id })
  return user
}
```

```ts effect
// fragment
function load(id: string) {
  return Effect.gen(function* () {
    const user = yield* findUser(id)
    if (!user) return yield* Effect.fail(new NotFound({ id }))
    return user
  })
}
```

## Calls that may throw

The type system tracks whether a function may throw, and what it throws. Tracking applies only to non-effectful functions (VIP-4, amended 2026-10-29: "an effectful function literally cannot throw").

- A function that returns an Effect, Stream or Layer counts as effectful and can't throw: an `effect` function, Effect's own `sleep`, `tryPromise`, `sync` and `Effect.try`, a service member whose type is an Effect, or a `.ts` function whose return type is `Effect`. A call of it is never throw-tracked, and its failures are its Effect's error channel. So none of them rethrows a callback.
- This exemption takes precedence over body inference, including for a plain `.vibe` function returning an Effect, Stream or Layer. It is a static contract, not a JavaScript runtime guarantee: a foreign implementation that throws before returning produces a defect when called inside effect code.
- Otherwise, a plain, non-`async` `.vibe` function's thrown type is inferred from its body: an uncaught `throw`, or an unwrapped call of a function that may throw. Koka infers its `exn` effect the same way.
- An `async` call returns a Promise even when its body throws: its synchronous thrown type is `never` (`@throws {never}`); rejection is not a tracked throw. Exceptions while evaluating its arguments belong to the caller.
- A non-effectful library or global function says what it throws with the JSDoc tag `@throws {ErrorType}`. Such a library or global declaration with no `@throws` is assumed to throw `unknown`. `@throws {never}` says it can't throw.
- JavaScript's globals carry no tags in `lib.d.ts`. VibeLang ships its own annotations for them, so `JSON.parse` throws `SyntaxError` and `Math.max` is known not to throw.
- A function type or interface member without `@throws` is non-throwing; `@throws` on its declaration opts in. This differs from an unannotated foreign library function, whose thrown type is `unknown`.
- `new X()` is throw-tracked; getter and setter access is not.
- `@rethrows callback` declares that a non-effectful call propagates the thrown type of the named callback. Shipped annotations cover `map`, `forEach`, `filter`, `reduce`, `find`, `some`, `every`, `sort`, `Array.from` and the `Promise` executor. Storing a callback, as `setTimeout` does, does not rethrow it. Promise-producing calls still require wrappers.
- VibeLang also ships annotations for Effect's non-effectful exports: `Option.some` throws `never`; `Schema.decodeUnknownSync` throws `SchemaError`.
- Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked. They are defects, as in `Effect.sync`.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| In effect code, a direct call of a function that may throw. Wrap it: `try Effect.try(() => parse(s))` | code pending |
| In effect code, a call returning a Promise or thenable, even if assigned to a variable and never awaited. Move the call into the thunk passed to `tryPromise` or `promise`, whether or not it can reject | code pending |

A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function that doesn't throw directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md).

```vibe es
// compiler-gap: pending VIP-4
function parse(s: string) { if (!s) throw new Error("empty"); return s }   // may throw Error (inferred)
function add(a: number, b: number) { return a + b }                         // doesn't throw

effect function load(s: string, q: string) {
  add(1, 2)                                      // ok: doesn't throw
  parse(s)                                       // error: may throw
  const p = try Effect.try(() => parse(s))       // ok
  const r = try tryPromise(() => queryDb(q))     // a Promise is always wrapped; queryDb is from a .ts module
  return [p, r]
}
```

`Effect.try` keeps its module prefix because `try` is a reserved word ([VIP-6](../vips/0006-effect-globals.md)).

The annotations affect checking, not the JavaScript implementation:

```vibe es
// compiler-gap: pending VIP-4
/** @rethrows callback */
function invoke(callback: () => string) { return callback() }
type Reader = () => string                       // no throws by default
function stream(text: string) { return Stream.succeed(text) }
function layer() { return Layer.empty }          // both exempt from tracking
class Input {
  constructor(readonly text: string) { if (!text) throw new Error("empty") }
  get value() { return this.text }               // access is not throw-tracked
}
effect function checked(text: string) {
  const input = try Effect.try(() => new Input(text)) // constructor is tracked
  const some = Option.some(input.value)                  // non-throwing
  return try Effect.try(() => Schema.decodeUnknownSync(Schema.String)(text))
}
```

```ts effect
// fragment
/** @rethrows callback */
function invoke(callback: () => string) { return callback() }
type Reader = () => string                       // no throws by default
function stream(text: string) { return Stream.succeed(text) }
function layer() { return Layer.empty }          // both exempt from tracking
class Input {
  constructor(readonly text: string) { if (!text) throw new Error("empty") }
  get value() { return this.text }               // access is not throw-tracked
}
function checked(text: string) {
  return Effect.gen(function* () {
    const input = yield* Effect.try(() => new Input(text))
    const some = Option.some(input.value)
    return yield* Effect.try(() => Schema.decodeUnknownSync(Schema.String)(text))
  })
}
```

**Undecided (pending VIP):** how to classify return types such as `any` or `Effect.Effect<number> | undefined` for the effectful exemption, and how exported callable constants, methods and callable-type declarations retain inferred throw metadata. VIP-27 specifies function exports but not all these representations.

## `error` declarations

### Syntax

```text
ErrorDeclaration = "export"? "error" Name ("{" ErrorBody "}")?
ErrorBody        = (ErrorField | Method | Getter)*
ErrorField       = PropertyName "?"? ":" Type ";"?
Method           = TypeScript MethodDeclaration (no static modifier)
Getter           = TypeScript GetAccessor (no static modifier)
```

`error` is a contextual keyword on the same line as its name, so `const error = …` and `catch (error)` still work.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| a constructor in an `error` body | code pending |
| a `_tag` member in an `error` body | code pending |
| an `extends` clause, `error UserNotFound extends NotFound { … }` | code pending |
| a user-written `static` member or setter, in either error form | code pending |
| type parameters, such as `error Invalid<T> { value: T }`, in either error form | code pending |

### Meaning

`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly. Fields, methods and getters may be interleaved, as in a TypeScript class.

User-written `static` members and setters are forbidden in both forms. The compiler-supplied matcher below is the exception; its `Symbol.customMatcher` shim is described in [Pattern matching](004-match.md#class-patterns).

```vibe es
// compiler-gap: pending VIP-13
error NotFound {
  id: string
  get message() { return `no user ${this.id}` }
}
error Timeout
```

```ts effect
// fragment
class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {
  get message() { return `no user ${this.id}` }
  static [Symbol.customMatcher](subject: unknown) {          // VIP-7: tests _tag
    return (subject as { _tag?: unknown } | null)?._tag === "NotFound" ? [subject] : false
  }
}
class Timeout extends Data.TaggedError("Timeout") {
  static [Symbol.customMatcher](subject: unknown) {
    return (subject as { _tag?: unknown } | null)?._tag === "Timeout" ? [subject] : false
  }
}
```

The matcher gives `[subject]` on a match, so `when NotFound(let e):` binds the error, and `false` otherwise. An error is constructed with its fields as one object, `new NotFound({ id })`. Two packages that both declare `error NotFound` match each other in `match`, as with Effect's `catchTag`, because an `error` class's matcher tests `_tag` ([Pattern matching](004-match.md#class-patterns)).

An `error` always extends `Data.TaggedError`. Group errors with a union, `type LookupError = NotFound | Timeout`: tagged errors are matched by `_tag`, and a subclass would match two tags.

Neither form accepts type parameters. For example, `error Invalid<T> { value: T }` and `schema error Invalid<T> { value: T }` are compile errors.

## `schema error` declarations

### Syntax

```text
SchemaErrorDeclaration = "export"? "schema" "error" Name ("{" ErrorBody "}")?
```

`ErrorBody` and its optional `ErrorField` production are shared with `error`; each field uses the schema field mapping (including optional properties). Omitting the body means no fields, as for `error Timeout`.

`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token.

### Meaning

`schema error Name { fields }` combines `error` and the field mapping of `schema` declarations ([Data](006-data.md#schema-declarations)). Fields are written as TypeScript types and mapped to Schemas, so the error can be decoded from JSON and crosses workers and RPC. The body rules, and their diagnostics, are those of `error` declarations.

```vibe es
// compiler-gap: pending VIP-29
schema error NotFound { id: string }
schema error Timeout
```

```ts effect
// fragment
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {
  static [Symbol.customMatcher](subject: unknown) {          // as for error
    return (subject as { _tag?: unknown } | null)?._tag === "NotFound" ? [subject] : false
  }
}
class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {}) {
  static [Symbol.customMatcher](subject: unknown) {
    return (subject as { _tag?: unknown } | null)?._tag === "Timeout" ? [subject] : false
  }
}
```
