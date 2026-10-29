# Failures

Sources: [VIP-4](../vips/0004-throw.md), [VIP-13](../vips/0013-error-declarations.md), [VIP-29](../vips/0029-schema-errors.md). Handling failures with `catch` is in [Running Effects](002-running.md#catch), and matching them is in [Pattern matching](004-match.md).

## `throw`

### Meaning

`throw` and `Promise.reject` are allowed everywhere.

| Where | `throw e` means |
| --- | --- |
| a plain or `async` function, or the top level | JavaScript's `throw` |
| effect code | the Effect fails with `e`, a typed error: `yield* Effect.fail(e)` |

```vibe es
// compiler-gap: pending VIP-4
effect load(id: string) {
  const user = try findUser(id)
  if (!user) throw new NotFound({ id })
  return user
}
```

```ts effect
// fragment
const load = (id: string) => Effect.gen(function* () {
  const user = yield* findUser(id)
  if (!user) return yield* Effect.fail(new NotFound({ id }))
  return user
})
```

## Calls that may throw

The type system tracks whether a function may throw, and what it throws.

- A `.vibe` function's thrown type is inferred from its body: an uncaught `throw`, or an unwrapped call of a function that may throw. Koka infers its `exn` effect the same way.
- A library or global function says what it throws with the JSDoc tag `@throws {ErrorType}`. A function with no `@throws` is assumed to throw `unknown`. `@throws {never}` says it can't throw.
- JavaScript's globals carry no tags in `lib.d.ts`. VibeLang ships its own annotations for them, so `JSON.parse` throws `SyntaxError` and `Math.max` is known not to throw.
- A call given a callback that may throw may itself throw, as Swift's `rethrows`.
- Implicit throws, such as reading a property of `undefined` or a stack overflow, are not tracked. They are defects, as in `Effect.sync`.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| In effect code, a direct call of a function that may throw. Wrap it: `try Effect.try(() => parse(s))` | code pending |
| In effect code, a Promise used without a wrapper. Wrap it with `tryPromise` or `promise`, whether or not it can reject | code pending |

A plain or `async` function may call a function that may throw, and then may throw itself. Effect code calls a function that doesn't throw directly.

```vibe es
// compiler-gap: pending VIP-4
function parse(s: string) { if (!s) throw new Error("empty"); return s }   // may throw Error (inferred)
function add(a: number, b: number) { return a + b }                         // doesn't throw

effect load(s: string, url: string) {
  add(1, 2)                                      // ok: doesn't throw
  parse(s)                                       // error: may throw
  const p = try Effect.try(() => parse(s))       // ok
  const r = try tryPromise(() => fetch(url))     // a Promise is always wrapped
  return [p, r]
}
```

`Effect.try` keeps its module prefix because `try` is a reserved word ([VIP-6](../vips/0006-effect-globals.md)).

**Undecided (pending VIP):**

- How a thrown type is carried by a function-typed value with no JSDoc: a parameter of type `(s: string) => string`, a function stored in a variable, a method of an interface. VIP-4 says only that library functions without `@throws` throw `unknown`.
- Whether constructors (`new X()`), getters and setters are tracked.
- How `rethrows` is expressed in a declaration, so a library function can say "throws what its callback throws".

## `error` declarations

### Syntax

```text
ErrorDeclaration = "export"? "error" Name ("{" ErrorBody "}")?
ErrorBody        = (Field | Method | Getter)*
```

`error` is a contextual keyword on the same line as its name, so `const error = …` and `catch (error)` still work.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| a constructor in an `error` body | code pending |
| a `_tag` member in an `error` body | code pending |
| an `extends` clause, `error UserNotFound extends NotFound { … }` | code pending |

### Meaning

`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly. The body may hold methods and getters, as any class can.

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
}
class Timeout extends Data.TaggedError("Timeout") {}
```

An error is constructed with its fields as one object, `new NotFound({ id })`. Two packages that both declare `error NotFound` match each other in `match`, as with Effect's `catchTag`, because an `error` class's matcher tests `_tag` ([Pattern matching](004-match.md#class-patterns)).

An `error` always extends `Data.TaggedError`. Group errors with a union, `type LookupError = NotFound | Timeout`: tagged errors are matched by `_tag`, and a subclass would match two tags.

**Undecided (pending VIP):** type parameters on an `error` (`error Invalid<T> { value: T }`).

## `schema error` declarations

### Syntax

```text
SchemaErrorDeclaration = "export"? "schema" "error" Name "{" SchemaFields (Method | Getter)* "}"
```

`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token.

### Meaning

`schema error Name { fields }` combines `error` and the field mapping of `schema` declarations ([Data](006-data.md#schema-declarations)). Fields are written as TypeScript types and mapped to Schemas, so the error can be decoded from JSON and crosses workers and RPC. The body rules, and their diagnostics, are those of `error` declarations.

```vibe es
// compiler-gap: pending VIP-29
schema error NotFound { id: string }
```

```ts effect
// fragment
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}
```
