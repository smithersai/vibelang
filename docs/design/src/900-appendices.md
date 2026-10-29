# Appendices

## Appendix A. Grammar

VibeLang's grammar is TypeScript's, plus three TC39 proposals and the productions below. Pattern matching is pinned to commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e` with its reconciliations ([Pattern matching](004-match.md)). Do expressions and the Hack pipe operator are pinned too (**Undecided (pending VIP):** their snapshots). Names not defined here (`Block`, `Type`, `Expression`, `ConciseBody`, …) are TypeScript's or ECMAScript's. `"x"` is a token; `X?` is optional; `X*` repeats.

### Contextual keywords

Every VibeLang keyword is contextual: it is a keyword only in the positions below, and an ordinary identifier everywhere else. Each one and the token after it are on one line.

| Word | Keyword when followed by | Chapter |
| --- | --- | --- |
| `effect` | `function`; an arrow's parameters (`(`, `<`, or an identifier then `=>`); a method name; `*` (methods); `{` | [Functions](001-functions.md) |
| `fork` | in effect code, as an `IdentifierReference`: an operand, or `.in(…)`, `.scoped`, `.detached` | [Running Effects](002-running.md#fork-and-join) |
| `join` | in effect code, as an `IdentifierReference`: an operand | [Running Effects](002-running.md#fork-and-join) |
| `concurrent` | after `for`, then `(` | [Running Effects](002-running.md#for-concurrent) |
| `uninterruptible`, `interruptible`, `restore` | `{` | [Running Effects](002-running.md#interruption-blocks) |
| `provide` | a provider list, then `{` | [Services](005-services.md#provide-blocks) |
| `service` | a name, then `{` | [Services](005-services.md#service-declarations) |
| `error` | a name | [Failures](003-failures.md#error-declarations) |
| `schema` | a name, or `error` and a name | [Data](006-data.md#schema-declarations) |
| `data` | a name | [Data](006-data.md#data-declarations) |
| `match`, `when`, `is`, `and`, `or`, `not` | as TC39's pattern-matching proposal says | [Pattern matching](004-match.md) |

In effect code, `fork` and `join` are keywords where an `IdentifierReference` could stand, as `await` is in an `async` function. A property name after `.` or `?.`, a property key, a label, a binding name and an import or export name stay identifiers:

```vibe es
// compiler-gap: pending VIP-17
const join = (xs: string[]) => xs.join(",")
effect function f(parts: Fiber.Fiber<string>, names: string[]) {
  const a = join(parts)        // joins the fiber parts
  const b = (join)(["x"])      // calls the function join
  const c = names.join(",")    // the method join
}
```

`fork` and `join` are not reserved words, so a line break ends them (ASI), and their operand starts on the same line. `try` and `catch` are reserved words already; VibeLang gives them new expression forms in effect code. As for `await`, `try`'s operand may start on the next line; a statement that starts with `try {` is TypeScript's `try` statement.

### Productions

```text
EffectFunction    = "effect" "function" Name? TypeParameters? Params ReturnType? Block
EffectArrow       = "effect" TypeParameters? ArrowParams ReturnType? "=>" ConciseBody
EffectMethod      = Modifiers? "effect" PropertyName TypeParameters? Params ReturnType? Block
Producer          = "effect" "function" "*" Name? TypeParameters? Params ReturnType? Block
ProducerMethod    = Modifiers? "effect" "*" PropertyName TypeParameters? Params ReturnType? Block
Params            = "(" FormalParameters ")"
ArrowParams       = ArrowParameters            (an identifier or a parenthesized list)
Modifiers         = the class-member modifiers TypeScript allows before async

EffectType        = EffectOperand "!" EffectOperand "!" EffectOperand
                  | EffectOperand "!" EffectOperand
                  | EffectOperand "!" "!" EffectOperand
                  | EffectOperand "!" "!"
EffectOperand     = a Type that is not an unparenthesized EffectType

TryExpression     = "try" UnaryExpression
CatchExpression   = (CatchExpression | Operand) "catch" Handler
Handler           = HandlerFunction | "effect" Block | Operand      (the first that matches)
HandlerFunction   = EffectArrow | ArrowFunction | "(" HandlerFunction ")"
Operand           = BitwiseORExpression
EffectBlock       = "effect" Block
ForkExpression    = "fork" ForkOperand
                  | "fork" "." "in" "(" AssignmentExpression ")" ForkOperand
                  | "fork" "." "scoped" ForkOperand
                  | "fork" "." "detached" ForkOperand
JoinExpression    = "join" ForkOperand
TryAll            = "try" "." ("all" | "race" | "any" | "allSettled") UnaryExpression

ForConcurrent     = "for" "concurrent" ("(" AssignmentExpression ")")? "(" ForBinding "of" AssignmentExpression ")" Statement
ForTry            = "for" "try" "(" ForBinding "of" AssignmentExpression ")" Statement
ForBinding        = the head of ECMAScript's for…of before "of"
Uninterruptible   = "uninterruptible" Block
Restore           = "restore" Block
Interruptible     = "interruptible" Block
ProvideStatement  = "provide" Provider ("," Provider)* Block
Provider          = LeftHandSideExpression "=" AssignmentExpression | ConditionalExpression

ServiceDecl       = "export"? "service" Name "{" (Member | KeyMember | DefaultMember)* "}"
Member            = PropertySignature | MethodSignature
KeyMember         = "static" "readonly" "key" "=" StringLiteral
DefaultMember     = "static" "readonly" "defaultValue" "=" Expression
ErrorDecl         = "export"? "error" Name ("{" ErrorBody "}")?
SchemaErrorDecl   = "export"? "schema" "error" Name ("{" ErrorBody "}")?
ErrorBody         = (Field | Method | Getter)*
Method            = a non-static MethodDeclaration
Getter            = a non-static get accessor
Field             = PropertyName "?"? ":" Type ";"?
SchemaDecl        = "export"? "schema" Name ("{" SchemaFields "}" | "=" Type)
SchemaFields      = ("readonly"? Field)*
DataDecl          = "export"? "data" Name TypeParameters? "{" Variant ((";" | LineTerminator) Variant)* ";"? "}"
Variant           = Name ("{" Field* "}")?
```

`catch` has the precedence of `??` and is left-associative (VIP-5). An arrow handler's body extends as far as any arrow body:

```text
a catch b catch c            (a catch b) catch c
a catch (e) => b catch c     a catch ((e) => (b catch c))
a catch ((e) => b) catch c   (a catch ((e) => b)) catch c     a parenthesized arrow is a handler
a catch (effect { b })       the fallback is the unrun Effect   a parenthesized block is a value
a catch f                    the fallback is the value f         syntax decides, never types
```

When a fallback's type is a function or an Effect, a VIP-38 lint warning offers `catch (e) => …` and `catch effect { … }` ([Running Effects](002-running.md#catch)).

`A!B!C` is always the three-slot form; write `(A!B)!C` to nest.

After `for concurrent`, a parenthesized group followed by another `(` is the concurrency limit: `for concurrent (4) (const x of xs)`.

`try` has `await`'s precedence, because `try` works like `await`. **Undecided (pending VIP):** `ForkOperand`, the precedence of `fork` and `join` (a `UnaryExpression` or an `AssignmentExpression`), the precedence of `!` among type operators (`A!E | B`), and whether referencing a binding named `fork` or `join` in effect code is a diagnostic (`join - 1` there joins `-1`).

## Appendix B. Diagnostics

Every diagnostic has an `EK` code and a message that says how to fix it (VIP-34). These codes are assigned, each one already in the compiler's registry:

| Code | Rule | VIP |
| --- | --- | --- |
| EK2109 | a `schema` field type outside the mapping | 15 |
| EK2111 | `restore` outside an `uninterruptible` block | 22 |
| EK3001 | two services with the same key | 9 |
| EK3002 | a class extends a service | 9 |
| EK3003 | `new` on a service | 9 |
| EK3004 | `instanceof` a service | 9 |
| EK3005 | a generic service | 9 |
| EK4402 | a `node:*` value import, a Node global or a platform call in a `.vibe` file | 33 |
| EK4701 | a `match` with no `default` over a literal union, `boolean`, a `data` or `error` union or an enum, that misses a case; a guarded arm covers nothing | 7 |

**Undecided (pending VIP):** the codes of every other rule in this specification, each marked "code pending" where it is defined:

| Rule | Chapter |
| --- | --- |
| `try` outside effect code, the top level included; `try` on a value that is not an Effect; a `try` statement in effect code | [Running Effects](002-running.md#try) |
| `effect f() { }` or `async f() { }` outside a class or object literal; `await` in effect code; `await` on an Effect in an `async` function | [Functions](001-functions.md#static-rules) |
| `catch` outside effect code; `try x catch y`; `e catch y` where `e` is not an Effect; `catch` mixed with `??`, `\|\|` or `&&` without parentheses | [Running Effects](002-running.md#catch) |
| `fork`, `join`, `for concurrent`, `for try`, interruption blocks or `provide` outside effect code | [Running Effects](002-running.md), [Services](005-services.md#provide-blocks) |
| a `try.all` operand that is not an array of Effects | [Running Effects](002-running.md#running-effects-concurrently) |
| `break`, `return` or a labeled `continue` leaving `for concurrent`; `return` in `for try` | [Running Effects](002-running.md) |
| `return value` in a producer | [Running Effects](002-running.md) |
| an unwrapped call that may throw, or an unwrapped Promise, in effect code | [Failures](003-failures.md#calls-that-may-throw) |
| a service member with a body, `private` or `protected`, or a `static` other than `key` and `defaultValue` | [Services](005-services.md#static-rules) |
| a constructor, `_tag`, `extends`, a `static` member, a setter or type parameters in an `error` or `schema error` declaration | [Failures](003-failures.md#error-declarations) |
| a `data` declaration with more than 4 type parameters | [Data](006-data.md) |
| warning: a `catch` fallback whose type is a function or an Effect | [Running Effects](002-running.md#catch) |
| warning: `using` in effect code | [Runtime](008-runtime.md) |

The compiler's current registry (`typescript/tsc/internal/vibelang/diagnostics.go`) still carries the old language's codes, documented in `docs/design/history/src/428-part4-ch28-tooling.md`. It is not normative.

## Appendix C. Denied and open VIPs

### Denied VIPs

A denied VIP is not part of the language. Each records what was proposed and why it was denied.

| VIP | Denied | Instead |
| --- | --- | --- |
| [8](../vips/0008-using-denied.md) | special syntax for Effect resources (`using` with Effect meaning, a `scoped` keyword) | `using` is TypeScript's; Effect resources use `scoped(effect { … })` |
| [10](../vips/0010-service-call-shorthand-denied.md) | the `Users.find(id)` shorthand | `try (try Users).find(id)` |
| [11](../vips/0011-trailing-blocks-denied.md) | trailing blocks, `f(x) { … }` | `f(x, () => { … })` or `f(x, effect { … })` |
| [24](../vips/0024-wire-denied.md) | `wire`, automatic layer composition | Effect's `Layer.provide` and `Layer.provideMerge` |
| [25](../vips/0025-inline-modules-denied.md) | inline `module` declarations as a TypeScript escape | a `.ts` file |

### Open VIPs

Listed for a future decision; not part of the language.

| VIP | Title |
| --- | --- |
| [35](../vips/0035-handlers-open.md) | Effect handlers (`control`, `handle`, `resume`, `abandon`) |
| [36](../vips/0036-manifest-open.md) | The declaration manifest |
| [37](../vips/0037-effectify-the-universe-open.md) | Effectify the universe |

The proposals page lists further ideas, each to get its own VIP: durable execution, compile-time evaluation, build-time host selection, validators derived from types, typed asset imports, custom loaders, Rust and Zig source imports, a coding-agent library, typed workers, shared structs, declarations in conditionals, toolchain commands, bundler plugins, mandatory compiler options, JSX source files and a TC39 adopt-early list.

## Appendix D. Flipping pending examples

Every VibeLang example in this specification starts with `// compiler-gap: pending VIP-N`, and every Effect TypeScript example that names functions it doesn't declare starts with `// fragment`. The snippet checker reports a `compiler-gap` block as a known gap, not a failure.

To check the specification's examples:

```sh
bun docs/tools/check-snippets.ts --root docs/design/src
```

When the compiler implements VIP-N:

1. Run the command above. A block whose marker is stale fails with "Stale compiler-gap marker; remove it": the compiler now accepts it.
2. Delete that block's `// compiler-gap: pending VIP-N` line. If the block only names functions it doesn't declare (`fetchUser`), declare them in the block or a page fixture, or mark it `// fragment`.
3. When a page has no `compiler-gap` markers left, add `docs/design/src` to the snippet step of the merge queue's gate (`//:snippets`), so the examples stay checked.
4. To make an Effect TypeScript example checked, replace `// fragment` with the declarations it needs; the checker compiles ```` ```ts effect ```` blocks as comparisons.

## Appendix E. Shipped `@throws` and `@rethrows` annotations

`@throws` applies only to non-effectful functions. An `effect` function, or a function that returns an `Effect`, `Stream` or `Layer`, can't throw and is never throw-tracked ([Failures](003-failures.md#calls-that-may-throw)). VibeLang ships annotations for JavaScript's globals and for Effect's exports that don't return one of those:

| Function | Annotation |
| --- | --- |
| `JSON.parse` | `@throws {SyntaxError}` |
| `Math.max`, `Option.some` | `@throws {never}` |
| `Schema.decodeUnknownSync` | `@throws {SchemaError}` |
| `map`, `forEach`, `filter`, `reduce`, `find`, `some`, `every`, `sort`, `Array.from`, the `Promise` executor | `@rethrows` the callback |

`setTimeout` does not rethrow, because it stores the callback. A library declares rethrowing with `@rethrows <param>`:

```ts
/** @throws {never} @rethrows f */
export declare function each<T>(xs: readonly T[], f: (x: T) => void): void
```

```vibe es
// compiler-gap: pending VIP-4
effect function parse(s: string, xs: number[]) {
  const top = Math.max(...xs)                           // throws nothing
  const doubled = xs.map((x) => x * 2)                  // rethrows the arrow, which throws nothing
  const v: unknown = try Effect.try(() => JSON.parse(s)) // may throw SyntaxError: wrapped
  return { top, doubled, v }
}
```

```ts effect
import { Effect } from "effect"

function parse(s: string, xs: number[]) {
  return Effect.gen(function* () {
    const top = Math.max(...xs)
    const doubled = xs.map((x) => x * 2)
    const v: unknown = yield* Effect.try(() => JSON.parse(s))
    return { top, doubled, v }
  })
}
```

**Undecided (pending VIP):** the annotation of each remaining global and Effect export.
