# Appendices

## Appendix A. Grammar

VibeLang's grammar is TypeScript's, with the TC39 proposals for do expressions, pattern matching and the Hack pipe operator, each pinned to a dated snapshot, plus the productions below. Names not defined here (`Block`, `Params`, `Type`, `Expression`, …) are TypeScript's. `"x"` is a token; `X?` is optional; `X*` repeats.

### Contextual keywords

Every VibeLang keyword is contextual: it is a keyword only in the positions below, and an ordinary identifier everywhere else. Each one and the token after it are on one line.

| Word | Keyword when followed by | Chapter |
| --- | --- | --- |
| `effect` | `function`, `(` or `<` of an arrow's parameters, a method name, `*` (methods), `{` | [Functions](001-functions.md) |
| `fork` | an expression, or `.in(…)`, `.scoped`, `.detached` | [Running Effects](002-running.md#fork-and-join) |
| `join` | an expression | [Running Effects](002-running.md#fork-and-join) |
| `concurrent` | after `for`, then `(` | [Running Effects](002-running.md#for-concurrent) |
| `uninterruptible`, `interruptible`, `restore` | `{` | [Running Effects](002-running.md#interruption-blocks) |
| `provide` | a provider list, then `{` | [Services](005-services.md#provide-blocks) |
| `service` | a name, then `{` | [Services](005-services.md#service-declarations) |
| `error` | a name | [Failures](003-failures.md#error-declarations) |
| `schema` | a name, or `error` and a name | [Data](006-data.md#schema-declarations) |
| `data` | a name | [Data](006-data.md#data-declarations) |
| `match`, `when`, `is`, `and`, `or`, `not` | as TC39's pattern-matching proposal says | [Pattern matching](004-match.md) |

`try` and `catch` are reserved words already; VibeLang gives them new expression forms in effect code.

### Productions

```text
EffectFunction    = "effect" "function" Name? TypeParameters? Params ReturnType? Block
EffectArrow       = "effect" TypeParameters? ArrowParams ReturnType? "=>" ConciseBody
EffectMethod      = "static"? "effect" PropertyName TypeParameters? Params ReturnType? Block
Producer          = "effect" "function" "*" Name? Params ReturnType? Block
ProducerMethod    = "static"? "effect" "*" PropertyName Params ReturnType? Block

EffectType        = Type "!" Type "!" Type | Type "!" Type | Type "!" "!" Type | Type "!" "!"

TryExpression     = "try" UnaryExpression
CatchExpression   = (CatchExpression | Operand) "catch" (EffectArrow | "effect" Block | ArrowFunction | Operand)
Operand           = BitwiseORExpression
EffectBlock       = "effect" Block
ForkExpression    = "fork" ForkOperand
                  | "fork" "." "in" "(" AssignmentExpression ")" ForkOperand
                  | "fork" "." "scoped" ForkOperand
                  | "fork" "." "detached" ForkOperand
JoinExpression    = "join" ForkOperand
TryAll            = "try" "." ("all" | "race" | "any" | "allSettled") UnaryExpression

ForConcurrent     = "for" "concurrent" ("(" Expression ")")? "(" ForBinding "of" Expression ")" Statement
ForTry            = "for" "try" "(" ForBinding "of" Expression ")" Statement
Uninterruptible   = "uninterruptible" Block
Restore           = "restore" Block
Interruptible     = "interruptible" Block
ProvideStatement  = "provide" Provider ("," Provider)* Block
Provider          = LeftHandSideExpression "=" AssignmentExpression | ConditionalExpression

ServiceDecl       = "export"? "service" Name "{" ServiceMember* "}"
ErrorDecl         = "export"? "error" Name ("{" (Field | Method | Getter)* "}")?
SchemaErrorDecl   = "export"? "schema" "error" Name "{" SchemaFields (Method | Getter)* "}"
SchemaDecl        = "export"? "schema" Name ("{" SchemaFields "}" | "=" Type)
DataDecl          = "export"? "data" Name TypeParameters? "{" Variant ((";" | LineTerminator) Variant)* ";"? "}"
Variant           = Name ("{" Fields "}")?
```

`catch` has the precedence of `??` and is left-associative (VIP-5).

`try` has `await`'s precedence, because `try` works like `await`. **Undecided (pending VIP):** `ForkOperand`, the precedence of `fork` and `join` (a `UnaryExpression` or an `AssignmentExpression`), and the precedence of `!` among type operators.

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

**Undecided (pending VIP):** the codes of every other rule in this specification, each marked "code pending" where it is defined:

| Rule | Chapter |
| --- | --- |
| `try` outside effect code; `try` on a value that is not an Effect; `try x catch y`; a `try` statement in effect code | [Running Effects](002-running.md#try) |
| `effect f() { }` or `async f() { }` outside a class or object literal; `await` in effect code; `await` on an Effect in an `async` function; `try` at the top level | [Functions](001-functions.md#static-rules) |
| `catch` outside effect code; `catch` mixed with `??`, `\|\|` or `&&` without parentheses | [Running Effects](002-running.md#catch) |
| `fork`, `join`, `for concurrent`, `for try`, interruption blocks or `provide` outside effect code | [Running Effects](002-running.md), [Services](005-services.md#provide-blocks) |
| a `try.all` operand that is not an array of Effects | [Running Effects](002-running.md#running-effects-concurrently) |
| `break` or `return` in `for concurrent`; `return` in `for try` | [Running Effects](002-running.md) |
| `return value` in a producer | [Running Effects](002-running.md) |
| an unwrapped call that may throw, or an unwrapped Promise, in effect code | [Failures](003-failures.md#calls-that-may-throw) |
| a constructor, `_tag` or `extends` in an `error` or `schema error` declaration | [Failures](003-failures.md#error-declarations) |
| a `match` that is not exhaustive | [Pattern matching](004-match.md#exhaustiveness) |
| a `data` declaration with more than 4 type parameters | [Data](006-data.md) |

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

Every VibeLang example in this specification starts with `// compiler-gap: pending VIP-N`, and every Effect TypeScript example with `// fragment`. The snippet checker reports a `compiler-gap` block as a known gap, not a failure.

To check the specification's examples:

```sh
bun docs/tools/check-snippets.ts --root docs/design/src
```

When the compiler implements VIP-N:

1. Run the command above. A block whose marker is stale fails with "Stale compiler-gap marker; remove it": the compiler now accepts it.
2. Delete that block's `// compiler-gap: pending VIP-N` line. If the block only names functions it doesn't declare (`fetchUser`), declare them in the block or a page fixture, or mark it `// fragment`.
3. When a page has no `compiler-gap` markers left, add `docs/design/src` to the snippet step of the merge queue's gate (`//:snippets`), so the examples stay checked.
4. To make an Effect TypeScript example checked, replace `// fragment` with the declarations it needs; the checker compiles ```` ```ts effect ```` blocks as comparisons.
