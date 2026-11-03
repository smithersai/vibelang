# Appendices

## Appendix A. Grammar

VibeLang's grammar is TypeScript's, plus three TC39 proposals and the productions below. This appendix is the only place a VibeLang production is written, and a `.vibex` file uses these productions unchanged, read with TypeScript's JSX language variant ([VIP-39](../vips/0039-vibex.md) adds no production); chapters show examples and link here by production name. Pattern matching is pinned to commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e` with its reconciliations ([Pattern matching](004-match.md)). Do expressions are pinned to `tc39/proposal-do-expressions` commit `3ef6d463b8163cbf222846b40d17178cca36e9e1` and the Hack pipe operator to `tc39/proposal-pipeline-operator` commit `5ac4dfd624e68b649e6f947885bf5ef67bac19f4`, each repository's head on 2026-10-28 (UTC), vendored in [`vips/tc39-do-expressions/`](../vips/tc39-do-expressions/README.md) and [`vips/tc39-pipeline-operator/`](../vips/tc39-pipeline-operator/README.md). Names not defined here (`Block`, `Type`, `UnaryExpression`, `ConciseBody`, …) are TypeScript's or ECMAScript's. `"x"` is a token; `X?` is optional; `X*` repeats; `[no LineTerminator here]` and `[lookahead ∉ …]` are ECMAScript's restrictions.

### The `[Effect]` parameter

VibeLang adds one grammar parameter, `[Effect]`, with the contextual boundaries below, following [TypeScript’s parser](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/parser.ts). The parameters and body of an `effect` function, arrow, method or producer, and the body of an `effect` block, parse with `[+Effect]`. The body of any source callable without an `effect` modifier parses with `[~Effect]`, retaining TypeScript’s own `[Await]` and `[Yield]` rules; an `async match` parses with `[~Effect, +Await]`, as a nested `async` function. Class heritage, decorator expressions and computed class element names keep their enclosing source context. Class field and enum member initializers parse with `[~Effect]`, even inside an effect function. Ordinary TypeScript checks on computed field names still apply. Static blocks inherit `[?Effect]` for keyword reservation, but cannot execute Effects. A nested explicit Effect callable or block starts its own normal context.

The grammar parameter determines reservation; permission to execute additionally excludes parameter lists and `static` blocks. “Effect code” ([Running Effects](002-running.md)) is code parsed with `[+Effect]` that has that permission. A computed class key, a decorator expression and an `extends` clause are effect code when their enclosing context is: `effect function f() { class C { [try key()]() { } } }` permits the `try`.

An `effect` function or producer expression's own [Name](#name) parses with the parameters of its body, `[+Effect]` included, as ECMAScript parses every function expression's name with its body's (`AsyncFunctionExpression : async function BindingIdentifier[~Yield, +Await]opt`). So `fork` or `join` as that name is `EK1702`, as `(async function await() { })` is a SyntaxError. A declaration's name and an overload signature's take the enclosing context, as `AsyncFunctionDeclaration` does, so `export effect function fork() { }` declares `fork` in plain code. A method name is a `PropertyName` or `ClassElementName`, which ECMAScript never reserves, so `{ effect join() { } }` is valid.

Under `[+Effect]`:

- `fork` and `join` are reserved words, as `await` is under `[+Await]` (VIP-17, amended). No next-token test applies. An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`, so `join(parts)` is always a [JoinExpression](#joinexpression), `join - 1` joins `-1`, and a parameter or local named `join` is a syntax error (`EK1702`). A plain or `async` arrow head inherits the enclosing `fork`/`join` reservation, including in an Effect callable's parameter list, through its binding names, defaults and destructuring; the `async` prefix does not reset the head. This follows ECMAScript's [arrow](https://tc39.es/ecma262/#sec-arrow-function-definitions) and [async-arrow head](https://tc39.es/ecma262/#sec-async-arrow-function-definitions) context rules. Both `const g = (join) => 1` and `const g = async (join) => 1` are `EK1702` there. Each arrow body then has its own source context: a plain body is `[~Effect, ~Await]`, an ordinary `async` body `[~Effect, +Await]`. A nested `function h(join) { }` resets the head as well as its body. Outside an enclosing Effect reservation, `fork` and `join` remain ordinary identifiers even in an ordinary `async` arrow's head and body: native async's own `await` reservation does not reserve these two names. They stay ordinary `IdentifierName`s, as `await` does: `parts.join(",")`, `o?.fork`, `{ join: 1 }` and `class { join() { } }` are names. After the keyword, `/` begins a regular expression, and the operand may follow a line break, as after `await`: `join` then `f` on the next line joins `f`.
- [TryExpression](#tryexpression), [CatchExpression](#catchexpression), [ForkExpression](#forkexpression), [JoinExpression](#joinexpression), [TryAll](#tryall), [ForConcurrent](#forconcurrent), [ForTry](#fortry), the interruption blocks and [ProvideStatement](#providestatement) parse in this context. In a parameter list or `static` block, a recognized execution form receives its applicable placement diagnostic ([Running Effects](002-running.md#static-rules)). Initializers parsed with `[~Effect]` follow the recovery rule below.

The same formal-parameter boundary rejects directly evaluated `await` with `EK0102` and `yield` with `EK2104` for Effect callables, producers included. Nested source callable or context boundaries keep their own native rules; this reserves no new names and permits no parameter suspension.

Under `[~Effect]` those productions don't exist, and `fork` and `join` are identifiers. As TypeScript parses `await x` in a plain function to report "only allowed in async functions", a parser recovers by parsing these productions under `[~Effect]` and reports the construct's "outside effect code" rule, except where the tokens are also valid TypeScript, which keep their TypeScript meaning. A [ProvideStatement](#providestatement) head is the exception: it wins in any code (VIP-12, amended), so the statement `provide / a / { }` in `function f(provide: number, a: number) { provide / a / { } }` is `EK1201`; after `return` no statement can start, so `return provide / a / { }` divides.


VIP-17’s outside-code identifier promise is contextual: a plain class’s static block keeps ordinary `fork`/`join` identifiers. This deliberately differs from ECMAScript’s unconditional `[+Await]` for static blocks; VibeLang reserves these two words only in the inherited Effect context, so module classification adds no global reservation. The same call syntax in an Effect-reserved static block is a recognized operation and receives `EK1701`.

The field and enum calls below are ordinary helper calls; the class head keeps the enclosing Effect context, and the nested block establishes its own. The Effect gives `Success([2, 3, 7])`:

```vibe es
// compiler-gap: pending VIP-1, VIP-2, VIP-5, VIP-17
import { Effect } from "effect"
function join(n: number): number { return n + 1 }
function fork(n: number): number { return n + 2 }
effect function contextBoundaries() {
  class Base {}
  class C extends (try Effect.succeed(Base)) {
    [try Effect.succeed("read")]() { return 1 }
    value = join(1)
    program = effect { return try Effect.succeed(7) }
  }
  enum E { A = fork(1) }
  const c = new C()
  return [c.value, E.A, try c.program] as const
}
class Plain { static { join(9); fork(9) } }
```

```ts effect
import { Effect } from "effect"

function join(n: number): number { return n + 1 }
function fork(n: number): number { return n + 2 }
const contextBoundaries = Effect.gen(function* () {
  class Base {}
  class C extends (yield* Effect.succeed(Base)) {
    [yield* Effect.succeed("read")]() { return 1 }
    value = join(1)
    program = Effect.gen(function* () { return yield* Effect.succeed(7) })
  }
  enum E { A = fork(1) }
  const c = new C()
  return [c.value, E.A, yield* c.program] as const
})
class Plain { static { join(9); fork(9) } }
```

Execution stays forbidden in the initializer or static block itself:

```vibe
// compiler-gap: pending VIP-1, VIP-5, VIP-17
import { Effect } from "effect"
effect function badStatic() {
  class Reserved { static { join(1) } } // EK1701
}
effect function badEnum() {
  enum E { A = try Effect.succeed(1) } // EK0501
}
```

```text
function f(p) { return try p }     try outside effect code
function f(p) { return join p }    join outside effect code
function f(p) { return join(p) }   a call to join
provide(x)                         a call to provide: no "{" on the same line
```

### Contextual keywords

<a id="declaration-keywords"></a>**Declaration keywords.** `service`, `error`, `schema` and `data` follow TypeScript's contextual keyword `type`, whose alias declaration is `type` [no LineTerminator here] `BindingIdentifier`. This is the one rule for all four, written once as the production [DeclarationStart](#declarationstart) and its five start productions under [Productions](#productions).

Where a TypeScript declaration can start (a `StatementListItem`, or after `export`), a `DeclarationStart` begins that declaration, longest alternative first. Anything else is ordinary TypeScript, where the word is an identifier: `const error = …`, `catch (error)`, `const e = error as Error`, `return data as User[]`, `const ok = schema satisfies Schema.Top` and `error instanceof NotFound;` (a reserved word is not a `BindingIdentifier`). After the name, the declaration's production decides the rest, and line breaks may separate its tokens as in a TypeScript `class` or `type` declaration: a body's `{` and a `schema` alias's `=` may follow line breaks. The one production-specific rule is the bodyless `error` and `schema error` form, under [ErrorDeclaration](#errordeclaration). No other line-break or disambiguation rule applies to these four words. For diagnostic recovery, a recognized service header missing its body is `EK0906`, an ordinary schema header missing its required body or admitted alias form is `EK1503`, and a data header missing its variant body is `EK1604`. A custom `service` in a native TypeScript ambient source context is `EK0907`, before the same missing-body recovery. Ambientness may be explicit or inherited through nested `declare namespace`, ambient external `declare module`, `declare global` or native declaration-file contexts where the source syntax otherwise occurs; neither `export` nor a complete body, key or default creates an ambient-service form. Ordinary native ambient declarations and generated `.d.ts` output keep their native rules. Recovery does not admit another declaration form or change contextual keyword classification, native TypeScript ambient declarations, independent type-parameter/member checks, or the admitted bodyless error forms.

```text
service Users                 one service: the body follows the name, as a class body does
{ find(): User }
error Timeout                 one error declaration with the field id
{ id: string }
schema Code                   one alias, as `type Code` then `= …` is
= "a" | "b"
service as { a: string };     a service named as
service as T;  error as T;    syntax errors: `T` can't follow the declaration of `as`;
schema as T;  data as T;      write (service as T); for the TypeScript assertion
schema satisfies T;           a syntax error, as for `as`: write (schema satisfies T);
schema error = T              a schema named error: `=` is not a BindingIdentifier
schema error E { }            a schema error E
const e = error as Error      an assertion: not where a declaration starts
error instanceof NotFound;    an expression: `instanceof` is not a BindingIdentifier
error                         an expression statement: no name on the line
Timeout                       then another
```

**Other contextual keywords.** Each word below is a keyword only before the tokens listed, on the same line, and an ordinary identifier everywhere else. Each is tested wherever its production can appear.

| Word | Keyword when followed by | Chapter |
| --- | --- | --- |
| `effect` | `function`; an arrow head, as for `async`: `(` … `)` then `=>`, `<` type parameters of such an arrow, or an identifier then `=>`; in a class or object literal: a method name (`ClassElementName`, `#m` included) then `(` or `<`, `*`, or `get` or `set` then a name ([EffectAccessor](#effectaccessor)), as TypeScript parses `async get x()`; on an `interface` or type literal member: a member name or `[`, where TypeScript parses an `async` modifier and reports TS1070 or TS1071, so that `EK0108` reports it; at a statement start, a name other than `as`, `satisfies` or `is`, then `(` or `<` ([EffectShorthand](#effectshorthand)); `{` in an expression position only, so in a heritage clause (`class C extends effect { }`, `class C implements effect { }`, `interface I extends A, effect { }`) `effect` is an identifier and `{` starts the body, as in TypeScript. `effect * rate` is a multiplication; `effect(x)` with no `=>` is a call; `class C extends effect { }` extends a value named `effect`. `effect async` and `async effect` before any of these forms parse as an [EffectModifier](#effectmodifier), so `EK0105` reports them | [Functions](001-functions.md) |
| `concurrent` | after `for` (line break allowed), then `(` | [Running Effects](002-running.md#for-concurrent) |
| `uninterruptible`, `interruptible`, `restore` | `{` | [Running Effects](002-running.md#interruption-blocks) |
| `provide` | at a statement start when a valid [ProvideStatement](#providestatement) head parses, or bounded recovery relaxes only line breaks immediately before/after top-level provider commas; the ordinary provider grammar, no break after `provide` and same-line final `{` still apply; otherwise an identifier | [Services](005-services.md#provide-blocks) |
| `match`, `when`, `is`, `and`, `or`, `not` | as TC39's pattern-matching proposal says; where both parses exist, prefix `not` wins syntactically over a member/extractor rooted at an identifier `not`, before early errors and without consulting bindings | [Pattern matching](004-match.md) |

`try` and `catch` are reserved words already; VibeLang gives them expression forms under `[+Effect]`. At the start of a statement, `try` followed by `{`, on the same line or not, is TypeScript's `try` statement, as in JavaScript.

### Productions

Each declaration production starts with its own start production (`ServiceDeclaration` with `ServiceStart`, and so on); `export` and `export default` come from ECMAScript's `ExportDeclaration`, so `export error E { }` parses and `export default error E { }` is a syntax error (`export default` takes only a function or class declaration or an expression).

#### DeclarationStart

```text
DeclarationStart = ServiceStart | ErrorStart | SchemaErrorStart | SchemaStart | DataStart
```

#### ServiceStart

```text
ServiceStart     = "service" [no LineTerminator here] BindingIdentifier
```

#### ErrorStart

```text
ErrorStart       = "error"   [no LineTerminator here] BindingIdentifier
```

#### SchemaErrorStart

```text
SchemaErrorStart = "schema"  [no LineTerminator here] "error" [no LineTerminator here] BindingIdentifier
```

#### SchemaStart

```text
SchemaStart      = "schema"  [no LineTerminator here] BindingIdentifier
```

#### DataStart

```text
DataStart        = "data"    [no LineTerminator here] BindingIdentifier
```

#### EffectModifier

```text
EffectModifier = "effect"
               | "effect" [no LineTerminator here] "async"   (parses, then EK0105 rejects it)
               | "async" [no LineTerminator here] "effect"   (parses, then EK0105 rejects it)
```

Each two-word form needs a function, a method name, arrow parameters or an expression-position block after it, so TypeScript's forms keep their meaning: `async effect => 1` is an `async` arrow whose parameter is `effect`, `async effect() { }` is an `async` method named `effect`, and `effect async() { }` is an `effect` method named `async`.

A recognized `effect` modifier follows TypeScript’s `async` diagnostic recovery positions too. An `abstract` declaration, ambient `declare` context, or an `interface` or type literal member with that modifier is rejected with `EK0108` ([Functions](001-functions.md#static-rules)). Recognition is syntactic: identifiers named `effect` retain their ordinary member reading. Function/class overload signatures follow TypeScript’s ordinary admission and compatibility. A starred bodyless signature parses as its `async` counterpart does and keeps TypeScript’s `TS1222`.

#### EffectFunction

```text
EffectFunction = EffectModifier [no LineTerminator here] "function" Name? TypeParameters? Params ReturnType? Block
               | EffectFunctionOverload
```

#### EffectFunctionOverload

```text
EffectFunctionOverload = EffectModifier [no LineTerminator here] "function" Name? TypeParameters? Params ReturnType? ";"   (function declarations only; TypeScript overload signatures and semicolon insertion)
```

Bodyless signatures follow TypeScript overload ordering, adjacent-implementation and compatibility checks, with the same name requirements as the corresponding `async` declaration. Function expressions, object-literal methods and arrows still require bodies. TypeScript rejects starred overload signatures (TS1222), `abstract async` methods (TS1243) and ambient `async` declarations (TS1040). The corresponding `effect` forms are rejected too: a starred signature keeps `TS1222`, and the other two are `EK0108`. A signature without a return annotation exposes `any`, as a bodyless `async` signature does, with TypeScript’s `TS7010` under `noImplicitAny`; it is not inferred from the implementation, so a written Effect type such as `string!!` gives the signature its checked contract.

#### EffectArrow

```text
EffectArrow = EffectModifier [no LineTerminator here] BindingIdentifier [no LineTerminator here] "=>" ConciseBody
            | EffectModifier [no LineTerminator here] TypeParameters? ArrowParams ReturnType? [no LineTerminator here] "=>" ConciseBody
```

#### EffectMethod

```text
EffectMethod = EffectClassMethod | EffectObjectMethod
```

#### EffectClassMethod

```text
EffectClassMethod = DecoratorList? Modifiers? EffectModifier [no LineTerminator here] ClassElementName TypeParameters? Params ReturnType? (Block | ";")   (TypeScript class methods and overload signatures, including semicolon insertion)
```

#### EffectObjectMethod

```text
EffectObjectMethod = EffectModifier [no LineTerminator here] PropertyName TypeParameters? Params ReturnType? Block
```

#### EffectAccessor

```text
EffectAccessor = DecoratorList? Modifiers? EffectModifier [no LineTerminator here] ("get" | "set") ClassElementName Params ReturnType? Block   (parses, then the getter/setter rule rejects it)
```

`DecoratorList` is TypeScript's class decorator list and is admitted only on class elements, with TypeScript placement checks; an object-literal method has none. This applies to producer methods and rejected accessor recovery too.

`effect get x() { }` is an `EffectAccessor`; `effect get() { }` is an `EffectMethod` named `get`. `async effect get x() { }` gets both `EK0104` and `EK0105`.

#### EffectShorthand

```text
EffectShorthand = ("effect" | "async") [no LineTerminator here] [lookahead ∉ { as, satisfies, is }] BindingIdentifier TypeParameters? Params ReturnType? Block   (at a statement start or after export; parses, then the top-level-shorthand rule rejects it)
```

The identifier-spelled expression operators `as`, `satisfies` and `is` retain their expression reading after a value named `effect` or `async`; they cannot select recovery for an invalid function shorthand. In particular, both statements below are VIP-7 `is` expressions, and the Effect succeeds with `2`:

```vibe es
// compiler-gap: pending VIP-1, VIP-7
class Point {}
effect function operatorHeads() {
  const effect: unknown = new Point()
  const async = 3
  let hits = 0
  effect is (Point) && (hits += 1)
  async is < 5 && (hits += 1)
  return hits
}
```

```ts effect
import { Effect } from "effect"

class Point {}
const operatorHeads = Effect.gen(function* () {
  const effect: unknown = new Point()
  const async = 3
  let hits = 0
  effect instanceof Point && (hits += 1)
  async < 5 && (hits += 1)
  return hits
})
```


`effect load() { }` and `async load() { }` outside a class or object literal are `EffectShorthand`s; the quick fix inserts `function`. Neither token sequence is valid TypeScript there, so no program changes meaning; `effect as (Handler);` stays a TypeScript type assertion.

#### Producer

```text
Producer = EffectModifier [no LineTerminator here] "function" "*" Name? TypeParameters? Params ReturnType? Block
         | EffectModifier [no LineTerminator here] "function" "*" Name? TypeParameters? Params ReturnType? ";"   (function declarations only; parses, then TypeScript's TS1222 rejects it)
```

#### ProducerMethod

```text
ProducerMethod = DecoratorList? Modifiers? EffectModifier [no LineTerminator here] "*" ClassElementName TypeParameters? Params ReturnType? (Block | ";")   (in a class, where ";" parses, then TypeScript's TS1222 rejects it; PropertyName and Block in an object literal, with no DecoratorList or Modifiers there)
```

#### Params

```text
Params = "(" FormalParameters ")"
```

#### Name

```text
Name = BindingIdentifier   (an expression's own name: the parameters of its body, [+Effect] included, and [+Yield] for a Producer; a declaration's or overload signature's: the enclosing context's)
```

#### ReturnType

```text
ReturnType = ":" Type   (TypeScript's return-type annotation, parsed as TypeScript parses it; a type takes no Effect parameter)
```

#### ArrowParams

```text
ArrowParams = "(" FormalParameters ")"   (TypeScript's parenthesized async-arrow parameters and checks)
```

#### Modifiers

```text
Modifiers = the class-member modifiers TypeScript allows before async (static, public, private, protected, override)
```

#### PipeExpression

```text
PipeExpression = ShortCircuitExpression "|>" PipeBody
```

#### PipeBody

```text
PipeBody = AssignmentExpression
```

These productions carry the enclosing `In`, `Yield`, `Await` and `Effect` grammar parameters consistently. Alongside the pinned covering-production restrictions on conditional, yield, assignment and arrow bodies, reject a body whose whole unparenthesized expression is a `PipeExpression`. Thus an unparenthesized chain has its unique sequential left-associated derivation; a parenthesized nested pipe remains valid with a separate topic scope. This restriction tests the whole body, not every nested occurrence of a pipe.

It is a Syntax Error if the `ShortCircuitExpression` of a `PipeExpression` is a `CatchExpression` whose handler is an `ArrowHandler`; the `|>` then belongs to the arrow's body, as `?` does under [ConditionalExpression](#conditionalexpression). So `a catch () => b |> % + 1` is `a catch (() => (b |> % + 1))`; write `(a catch () => b) |> % + 1` to pipe the recovered value.

#### EffectType

```text
EffectType = EffectOperand [no LineTerminator here] "!" [no LineTerminator here] EffectOperand [no LineTerminator here] "!" [no LineTerminator here] EffectOperand   (A!E!R)
           | EffectOperand [no LineTerminator here] "!" [no LineTerminator here] EffectOperand   (A!E)
           | EffectOperand [no LineTerminator here] "!" [no LineTerminator here] "!" [no LineTerminator here] [lookahead ≠ "{"] EffectOperand   (A!!R)
           | EffectOperand [no LineTerminator here] "!" [no LineTerminator here] "!"   (A!!)
```

#### EffectOperand

```text
EffectOperand = an ordinary TypeScript source type at the type-operator level (a primary type with postfix [] and [K], optionally after keyof, unique, readonly or infer), never an unparenthesized EffectType
```

At the optional `R` boundary after `!!`, prefer the present `R` among complete source parses when the following tokens on that line start a valid ordinary TypeScript source operand, except the existing unparenthesized `{` exclusion. A negative literal type is such an operand: `x as A!! - 1` consumes `-1` as `R`. This choice uses syntax, with no symbol lookup or whitespace distinction; parenthesize the whole omitted-`R` assertion before a following subtraction.

Only ordinary TypeScript source types are operands. The parser-only JSDoc forms `?T`, `T?`, `!T` and `*` are excluded, including inside parentheses; explicitly writing one gives the ordinary invalid-type diagnostic. At the optional-slot boundary, `?` and `*` instead remain expression operators where the surrounding expression admits them. An additional `!` follows the existing bang and non-null rules, rather than starting a JSDoc requirement. All existing line-break and union, intersection, function-type and conditional-type restrictions still apply.

```vibe
// compiler-gap: pending VIP-3
declare const x: unknown
type NegativeRequirement = number!!-1
const chosen = x as number!! ? 1 : 2 // omitted R, then conditional
const slot = x as number!! - 1      // R is -1
// @ts-expect-error: ordinary TypeScript arithmetic operand error
const product = x as number!! * 2   // omitted R, then multiplication
// @ts-expect-error: ordinary TypeScript arithmetic operand error
const subtract = (x as number!!) - 1 // omitted R, then subtraction
```

```ts effect
import type { Effect } from "effect"

declare const x: unknown
type NegativeRequirement = Effect.Effect<number, never, -1>
const chosen = x as Effect.Effect<number> ? 1 : 2
const slot = x as Effect.Effect<number, never, -1>
// @ts-expect-error: Effect values are not arithmetic operands
const product = (x as Effect.Effect<number>) * 2
// @ts-expect-error: Effect values are not arithmetic operands
const subtract = (x as Effect.Effect<number>) - 1
```

The unparenthesized `{` exclusion applies only to the optional `R` after `!!`, leaving a following function body available. A required error or requirement slot admits an ordinary object type: `A!{ reason: string }!{ service: number }` means `Effect.Effect<A, { reason: string }, { service: number }>`. The omitted-error spelling still needs `A!!({ service: number })` for that requirement.

An enclosing TypeScript tuple can mark the completed Effect type as an optional tuple element: `[A!E?]` means `[(Effect.Effect<A, E>)?]`, `[A!!?]` means `[(Effect.Effect<A>)?]`, and `[A!!-1?]` means `[(Effect.Effect<A, never, -1>)?]`. This allows omission and contributes `undefined` on indexed access, as in TypeScript; the `?` is not a JSDoc suffix inside a slot. A stray postfix `?` outside an independently admitted TypeScript punctuation context remains invalid.

A leading `<` does not start a type at the type-operator level: `x as A!! < 3` omits `R` and continues with a comparison, subject to ordinary operand checking. A generic function requirement needs parentheses, `A!!(<T>() => T)`. A leading `[` does start a tuple type, so `x as A!![0]` consumes `[0]` as `R`; `(x as A!!)[0]` requests a later element access, subject to ordinary type checking.

In an expression, `x as A!! as B` and `x as A!! satisfies B` retain the ordinary chained assertion or check when consuming the keyword as `R` would strand `B`. Priority is between complete source parses, not parser-recovery trees. This is not a token ban: TypeScript allows type aliases named `as` and `satisfies`, so a pure type `A!!as`, a required or parenthesized slot using those aliases, and `x as A!!as satisfies unknown` retain their valid present-`R` parse. When both complete source parses survive, prefer the present `R`, with no symbol lookup. A complete source parse includes TypeScript’s automatic semicolon insertion. With `x as A!!as` at the end of a line and `B` on the next, both parses complete: the present `R` ends the statement by ASI, leaving `B` a second statement, and the chained assertion continues across the line break, so the present `R` wins. On one line, `x as A!! as B` has no semicolon to insert after `as`, so only the chained assertion completes.

```vibe
// compiler-gap: pending VIP-3
type RequiredObjects = number!{ reason: string }!{ service: number }
type OptionalError = [number!string?]
type OptionalSuccess = [number!!?]
type OptionalNegative = [number!!-1?]
type GenericRequirement = number!!(<T>() => T)
type as = { service: number }
type satisfies = { other: string }
type NamedRequirement = number!!as
type OtherRequirement = number!string!satisfies

function assertions(x: unknown) {
  const asserted = x as number!! as unknown
  const checked = x as number!! satisfies unknown
  const named = x as number!!as satisfies unknown
  const tuple = x as number!![0]
  // @ts-expect-error: Effect values are not comparison operands
  const comparison = x as number!! < 3
  // @ts-expect-error: an Effect has no numeric index
  const indexed = (x as number!!)[0]
}

function lineBreak(x: unknown, B: unknown) {
  x as number!!as
  B // a second statement: the assertion above supplies R = as
}

effect function slotBoundaryWitness() {
  const empty: OptionalError = []
  const noError: OptionalSuccess = []
  return [empty.length, noError.length, empty[0] === undefined] as const
}
```

```ts effect
import { Effect } from "effect"

type RequiredObjects = Effect.Effect<number, { reason: string }, { service: number }>
type OptionalError = [(Effect.Effect<number, string>)?]
type OptionalSuccess = [(Effect.Effect<number>)?]
type OptionalNegative = [(Effect.Effect<number, never, -1>)?]
type GenericRequirement = Effect.Effect<number, never, (<T>() => T)>
type as = { service: number }
type satisfies = { other: string }
type NamedRequirement = Effect.Effect<number, never, as>
type OtherRequirement = Effect.Effect<number, string, satisfies>

function assertions(x: unknown) {
  const asserted = x as Effect.Effect<number> as unknown
  const checked = x as Effect.Effect<number> satisfies unknown
  const named = x as Effect.Effect<number, never, as> satisfies unknown
  const tuple = x as Effect.Effect<number, never, [0]>
  // @ts-expect-error: Effect values are not comparison operands
  const comparison = (x as Effect.Effect<number>) < 3
  // @ts-expect-error: an Effect has no numeric index
  const indexed = (x as Effect.Effect<number>)[0]
}

function lineBreak(x: unknown, B: unknown) {
  x as Effect.Effect<number, never, as>
  B
}

```

```ts effect
import { Effect } from "effect"

type OptionalError = [(Effect.Effect<number, string>)?]
type OptionalSuccess = [(Effect.Effect<number>)?]

function slotBoundaryWitness() {
  const empty: OptionalError = []
  const noError: OptionalSuccess = []
  return Effect.succeed([empty.length, noError.length, empty[0] === undefined] as const)
}
```

`slotBoundaryWitness()` succeeds with `[0, 0, true]`. These type boundaries change neither execution nor the Effect's error or requirement channels.

#### TryExpression

```text
TryExpression = [+Effect] "try" UnaryExpression   (where ECMAScript has AwaitExpression)
```

#### CatchExpression

<a id="shortcircuitexpression"></a>

```text
ShortCircuitExpression = LogicalORExpression | CoalesceExpression | [+Effect] CatchExpression | PipeExpression   (ECMAScript's, plus CatchExpression and the reconciled pipe entry)
```

```text
CatchExpression = CatchHead "catch" ArrowHandler | ClosedCatchExpression
```

<a id="conditionalexpression"></a>

```text
ConditionalExpression = ShortCircuitExpression "?" AssignmentExpression ":" AssignmentExpression
                      | ShortCircuitExpression   (ECMAScript's, plus the early error below)
```

It is a Syntax Error if the `ShortCircuitExpression` before `?` is a `CatchExpression` whose handler is an `ArrowHandler`; the `?` then belongs to the arrow's body.

It is a Syntax Error if the `ShortCircuitExpression` before `?` is a [PipeExpression](#pipeexpression). The pinned proposal gives `|>` the precedence of `=>` and assignment, looser than `?:`, and rejects a conditional as a pipe head or body, so `x |> f(%) ? 1 : 2` has one answer, a syntax error. A parenthesized pipe is a `ParenthesizedExpression`, and a pipe in either branch is an `AssignmentExpression`, so neither is affected:

```text
x |> f(%) ? 1 : 2           syntax error: write (x |> f(%)) ? 1 : 2 or x |> (f(%) ? 1 : 2)
(x |> f(%)) ? 1 : 2         the pipe result is the test
x |> (f(%) ? 1 : 2)         the conditional is the body
ok ? x |> % + 1 : 0         a pipe in a branch
```

<a id="closedcatchexpression"></a>

```text
ClosedCatchExpression = CatchHead "catch" NonArrowHandler
```

<a id="catchhead"></a>

```text
CatchHead = ClosedCatchExpression | BitwiseORExpression
```

#### CatchHandler

```text
CatchHandler = ArrowHandler | NonArrowHandler   (always a function literal; VIP-5, amended 2026-10-29)
```

<a id="arrowhandler"></a>

```text
ArrowHandler = ArrowFunction | EffectArrow   (no AsyncArrowFunction: VIP-5, amended)
```

<a id="nonarrowhandler"></a>

```text
NonArrowHandler = FunctionExpression | EffectFunction   (no generator, async or async generator expression: VIP-5, amended)
                | "(" CatchHandler ")"
```

Recovery for a parameter list followed directly by a block after `catch`, as in `try x catch (e) { B }`, reports `EK0509` without an additional `EK0505` for that same malformed handler. It admits no block-handler production. A well-formed function literal restores the ordinary head check; independent source-context and separate syntax diagnostics remain. The [handler repair rule](002-running.md#catch) preserves source jump targets and the selected plain or Effect handler kind.

#### EffectBlock

```text
EffectBlock = EffectModifier [no LineTerminator here] "{" FunctionBody[~Yield, ~Await, +Effect] "}"   (a PrimaryExpression; the body of effect () => { … })
```

The braces hold a function body, as `(effect () => { … })()` does: `return` ends the block's Effect with a value, and `yield`, or a `break` or `continue` whose target is outside the block, is a syntax error. So `const p = effect { return 1 }` parses at module top level.

Both `effect async { B }` and `async effect { B }` parse for recovery and receive `EK0105`. The block quick fix is to remove `async`, retaining `effect { B }`; `async { B }` is not admitted.

#### ForkExpression

```text
ForkExpression = [+Effect] "fork" ForkOperand
               | [+Effect] "fork" "." "in" "(" AssignmentExpression ")" ForkOperand
               | [+Effect] "fork" "." "scoped" ForkOperand
               | [+Effect] "fork" "." "detached" ForkOperand
```

#### JoinExpression

```text
JoinExpression = [+Effect] "join" ForkOperand   (a line break may follow "join", as after "await")
```

#### ForkOperand

```text
ForkOperand = UnaryExpression   (await's operand, as for try; VIP-17, amended: "exactly as await")
```

#### TryAll

```text
TryAll = [+Effect] "try" "." ("all" | "race" | "any" | "allSettled") UnaryExpression
```

As in `new . target`, whitespace, comments and line breaks may separate the tokens of `try.all`, `fork.in`, `fork.scoped` and `fork.detached`: `try . all [a, b]` is `try.all [a, b]`. Any other name after `try .` or `fork .` is a syntax error: `try.map x` is `EK1803` and `fork.other e` is `EK1705`. The retired `await.all`, `await.race`, `await.any` and `await.allSettled` are `EK1802`.

#### ForConcurrent

```text
ForConcurrent = [+Effect] "for" "concurrent" ("(" AssignmentExpression ")")? "(" ForDeclaration "of" AssignmentExpression ")" Statement
```

#### ForTry

```text
ForTry = [+Effect] "for" "try" "(" ForDeclaration "of" AssignmentExpression ")" Statement
```

`ForDeclaration` is ECMAScript's, `LetOrConst ForBinding`: a `const` or `let` declaration, destructuring included (VIP-19 and VIP-20, amended). `var`, `using`, `await using` and an assignment head are syntax errors (`EK1906` in `for concurrent`, `EK2005` in `for try`): `for try (x of s)` and `for try (o.x of s)` have no declaration; write `for try (const v of s) { x = v }`.

#### Uninterruptible

```text
Uninterruptible = [+Effect] "uninterruptible" [no LineTerminator here] Block
```

#### Restore

```text
Restore = [+Effect] "restore" [no LineTerminator here] Block
```

#### Interruptible

```text
Interruptible = [+Effect] "interruptible" [no LineTerminator here] Block
```

#### ProvideStatement

A head violating only the comma-adjacent `LineTerminator` restrictions remains a recovered `provide` statement and receives `EK1202` on either side of a provider-list separator; the outside-Effect `EK1201` rule still applies. This recovery does not relax the ordinary provider grammar, the restriction after `provide` or the final provider's same-line body-opening `{`. Provider-internal newlines remain allowed. Ordinary calls, element access, subtraction and expression positions after `return` retain their existing readings.


```text
ProvideStatement = [+Effect] "provide" [no LineTerminator here] Provider ([no LineTerminator here] "," [no LineTerminator here] Provider)* [no LineTerminator here] Block
```

No line break may come between `provide` and the first provider, on either side of a comma, or between the last provider and the block's `{` (VIP-12: "its providers and block must be on one line"). Inside a provider, line breaks are free, as in any expression:

```text
provide Users = {               a provide statement: the provider ends on the line of "{"
  find: (id) => f(id) } { … }
provide A,                      syntax error: a line break after ","
  B { … }
provide(x)                      a call: no "{" on the line where the provider ends
provide[0] = 1                  in effect code too: TypeScript, provide an identifier
provide - 1                     in effect code too: TypeScript, provide an identifier
provide / a / { }               a provide statement of the regex /a/: the cover rule wins, as an arrow head does
```

#### Provider

```text
Provider = LeftHandSideExpression "=" AssignmentExpression   (Key = value)
         | ConditionalExpression                             (a Layer)
```

#### ServiceDeclaration

```text
ServiceDeclaration = ServiceStart TypeParameters? ClassHeritage? "{" (ServiceMember Separator)* "}"   (a member that ends in a Block needs no Separator, as a class method)
```

<a id="servicemember"></a>

```text
ServiceMember = KeyMember | DefaultMember | Member   (separated as interface members)
```

#### Member

```text
Member = PropertySignature | MethodSignature | RejectedMember
```

<a id="rejectedmember"></a>

```text
RejectedMember = a ClassElement or a TypeScript TypeMember (a call or construct signature) that is not a PropertySignature, MethodSignature, KeyMember or DefaultMember   (parses, then a static rule rejects it)
```

#### KeyMember

```text
KeyMember = "static" "readonly" "key" (":" Type)? "=" StringLiteral
```

#### DefaultMember

```text
DefaultMember = "static" "readonly" "defaultValue" (":" Type)? "=" AssignmentExpression
```

A `DefaultMember` initializer uses the source class-field context: the enclosing Effect execution and `fork`/`join` reservation reset. An explicit Effect run there is outside effect code (`try e` is `EK0501`); an ordinary identifier call such as `join(...)` keeps its ordinary meaning. Native `await`/`yield`, nested callable boundaries and eager initializer/throw checks retain their native source rules. Evaluate the initializer at the declaration, with the enclosing Effect body's existing coldness; do not move it into the fallback callback because the emitted counterpart uses an options object.

#### ErrorDeclaration

```text
ErrorDeclaration = ErrorStart TypeParameters? ClassHeritage? ("{" ErrorBody "}")?   (no body: ends as a TypeScript statement)
```

The body of an `error` or `schema error` declaration is optional, as the body of TypeScript's `declare module "m"` is: when the next token after the name is `{`, however many line breaks precede it, or `<`, `extends` or `implements` on the name's line, the declaration continues; otherwise it ends as a TypeScript statement does, at `;`, a line break, `}` or the end of the file. So `error Timeout` then `const t = 1` on the next line is a declaration with no fields, then a `const`; `error Timeout` then `<T>(x: T) => x` is a declaration, then a generic arrow statement.

#### SchemaErrorDeclaration

```text
SchemaErrorDeclaration = SchemaErrorStart TypeParameters? ClassHeritage? ("{" ErrorBody "}")?   (no body: ends as a TypeScript statement)
```

#### ErrorBody

```text
ErrorBody = (Field | ClassMethod | EffectMethod | ProducerMethod | ";" | RejectedElement)*
```

#### ClassMethod

```text
ClassMethod = an ordinary TypeScript class MethodDeclaration, GetAccessorDeclaration or SetAccessorDeclaration, with its class modifiers, decorators and overload signatures
```

<a id="rejectedelement"></a>

```text
RejectedElement = a ClassElement (an EffectAccessor included) that is not a Field, ClassMethod, EffectMethod, ProducerMethod or ";"   (parses, then a static rule rejects it)
```

#### Field

```text
Field = "readonly"? PropertyName "?"? ":" Type Separator   (identifier, string/numeric or computed spelling; admission and evaluation use the declaration counterpart below)
```

For `schema` and `schema error`, computed names use native TypeScript runtime object-literal grammar and key-type checks, and execute once in native property evaluation order. For plain `error` and `data` payloads, they use native TypeScript type-member checks and are erased. A broad entity-name key can be admitted in a type member while a call, parenthesized or element-access expression receives `TS1170`; the corresponding runtime schema key can still be admitted. Independent native errors and the existing reserved-key/source-modifier checks remain.

#### Separator

```text
Separator = ";" | "," | a LineTerminator before the next token | before "}"   (after the Type is complete, as TypeScript's parseTypeMemberSemicolon)
```

Two members or fields with no `Separator` between them are a VibeLang syntax error with the owning declaration's code: `EK0908` in a `service` body, `EK1306` in an `error` or `schema error` body, `EK1504` in a `schema` body and `EK1605` in a `data` declaration's variant list or a variant's field list. The quick fix inserts `;` after the first. These bodies never report TypeScript's `TS1005` or `TS1442` for it; native `class` and `interface` members keep TypeScript's codes.

#### SchemaDeclaration

```text
SchemaDeclaration = SchemaStart "{" Field* "}"
                  | SchemaStart "=" Type
```

#### DataDeclaration

```text
DataDeclaration = DataStart TypeParameters? "{" (Variant (Separator Variant)* Separator?)? "}"
```

#### Variant

```text
Variant = IdentifierName ("{" Field* "}")?   (a "{" after the name is its field body, after any line breaks: the LineTerminator alternative of Separator does not apply before "{")
```

#### MatchExpression

```text
MatchExpression = "match" [no LineTerminator here] "(" Expression ")" [no LineTerminator here] MatchBody   (a PrimaryExpression; inherits the surrounding Yield, Await and Effect parameters)
```

This connects the pinned subject expression to VibeLang's [MatchBody](#matchbody), including `when` arms and the required final semicolon.

#### AsyncMatchExpression

```text
AsyncMatchExpression = "async" [no LineTerminator here] MatchExpression[~Yield, +Await, ~Effect]   (a PrimaryExpression)
```

The subject, patterns, guards and selected arm have this independent async-expression context. A source `return`, or a `break`/`continue` targeting outside that activation, is a syntax error, as specified in [Pattern matching](004-match.md#async-match); nested functions retain their own ordinary contexts. The expression can occur inside a plain function: its own `await` does not make that enclosing function async.

#### MatchBody

```text
MatchBody = "{" WhenArm (";" WhenArm)* (";" DefaultArm)? ";" "}"
          | "{" DefaultArm ";" "}"   (the pinned draft: at most one default, last, as its early errors require)
```

#### MatchArm

```text
MatchArm = WhenArm | DefaultArm
```

<a id="whenarm"></a>

```text
WhenArm = "when" MatchPattern ":" ArmBody
```

<a id="defaultarm"></a>

```text
DefaultArm = "default" ":" ArmBody
```

#### ArmBody

```text
ArmBody = Expression | "throw" Expression
```

#### ArrayPattern

```text
ArrayPattern = "[" MatchList "]"
```

This replaces the pinned draft's optional `MatchList`: the existing `MatchList` is nullable, so `[]` has one derivation. Empty and nonempty paths use the same cached Iterator Record and list matching; `[]` matches only an empty iterable. The snapshot's grammar parameters are inherited.

#### RegularExpressionPattern

```text
RegularExpressionPattern = RegularExpressionLiteral
                         | RegularExpressionLiteral "(" MatchList ")"
```

This is one added `MatchPattern` alternative, replacing the chapter's earlier bare-literal addition. The first branch is a Boolean regex test; the second uses the same extractor/list matching as a named `RegExp`, with the pinned nullable `MatchList` and inherited grammar parameters. The literal is evaluated once at its pattern position.

### Notes on the productions

**Do snapshot static predicates.** For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal. Every `ForTry` and `ForConcurrent` production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`. The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`. Thus nonfinal loop bodies are still visited, and a final added loop is rejected like a final native loop. Ordinary switch completion and loop jump restrictions stay unchanged. The [snapshot receipt](../vips/tc39-do-expressions/README.md#static-predicate-reconciliations) records these reconciliations without changing the upstream draft; [Running Effects](002-running.md#do-expressions) gives the completion witnesses.

**Pipe snapshot reconciliations.** The missing-topic early error checks the `AssignmentExpression` child with `ContainsOuterTopic`; the `PipeBody` boundary still returns `false`. Evaluation uses the actual `ShortCircuitExpression` input once, with `GetValue`, rather than the stale `ConditionalExpression` reference. `GetPrimaryTopicValue` reads `topicEnv.[[TopicValues]]`, not the unbound `envRec`. Binary XOR `^` and XOR assignment `^=` remain ordinary TypeScript operators despite the duplicated `%` in the token table. The [snapshot receipt](../vips/tc39-pipeline-operator/README.md) records these corrections without changing the upstream HTML; [Running Effects](002-running.md#the-pipe-operator) gives the examples.

**`catch`.** [CatchExpression](#catchexpression) sits in ECMAScript's precedence chain beside `CoalesceExpression`, and its head mirrors `CoalesceExpressionHead`: it binds like `??`, is left-associative, and can't be mixed with `??`, `||` or `&&` without parentheses, for the same structural reason `a ?? b || c` is a syntax error. The handler is a plain or `effect` arrow or function expression, possibly parenthesized, so its kind is decided by its syntax alone; any other handler is `EK0509` ([Running Effects](002-running.md#catch)). An unparenthesized arrow handler ends the chain: its `ConciseBody` is the longest `AssignmentExpression`, as in an ECMAScript arrow, so a later `catch` belongs to the body. Any other handler is a closed expression, after which only another `catch` or a lower-precedence operator can follow.

```text
a catch (() => b) catch (() => c)    (a catch (() => b)) catch (() => c); type-checks only when the inner catch gives an Effect: a's success (never, if a only fails) and b are both Effects
a catch () => b ? c : d              a catch (() => (b ? c : d))
a catch (e) => b catch () => c       error: under [~Effect] the arrow body is b catch () => c, parsed by recovery and reported as `catch` outside effect code (EK0504)
a catch effect (e) => b catch () => c
                                     a catch (effect (e) => (b catch (() => c)))
a catch function (e) { … }           a plain function handler
a catch (effect function (e) { … })  an effect function handler
a catch b                            syntax error: not a function literal; write a catch () => b
a catch effect { b }                 syntax error: an effect block is not a function literal
a catch class { }                    syntax error: a class is not a function literal
a catch async (e) => b               syntax error: remove async (VIP-5, amended)
a catch function* (e) { }            syntax error: remove *
```

**`for concurrent`.** A line break between `for` and `concurrent` is allowed, as in ECMAScript’s [`for await` grammar](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-for-in-and-for-of-statements) and TypeScript. After `for concurrent`, the first parenthesized group is the limit only when it parses as an `AssignmentExpression` and the next group is the for…of head. A group that holds `ForDeclaration of …` is the head, whatever follows it:

```text
for concurrent (4) (const x of xs) f(x)        limit 4
for concurrent (const x of xs) (try g(x));     no limit; the body is a parenthesized expression
```

Both loop layouts have the same Effect counterpart and give `Success(3)` here:

```vibe es
// compiler-gap: pending VIP-19
effect function multilineTotal() {
  let total = 0
  for
  concurrent (const x of [1, 2]) { total += x }
  return total
}
```

```ts effect
import { Effect } from "effect"

const multilineTotal = Effect.gen(function* () {
  let total = 0
  yield* Effect.forEach([1, 2], x => Effect.sync(() => { total += x }), {
    concurrency: "unbounded", discard: true
  })
  return total
})
```

**`!` in types.** `A!B!C` is always the three-slot form; write `(A!B)!C` to nest, and `A!!B!C` is a syntax error (`EK0302`). One rule explains every `[no LineTerminator here]` in the productions: a line break ends an Effect type. TypeScript stops its postfix type operators (`!`, `?`, `[]`) at a preceding line break, so in `x as User` followed by a line `!flag && fail()`, the type ends at `User`. A `[]` has a closing token and a slot doesn't, so the slot starts on the line of its `!`, which keeps `now(): number!!` and `later(): number!!` two members. A slot in parentheses may span lines. `R` after `!!` never starts with `{`; write `A!!({ … })` for a type-literal requirement. In a type, directly after `A!`, where the next `!` completes `A!!`, the scanner reads that `!` alone and rescans from the next character (`=`, `==`, `===` or `=>`), as TypeScript rescans `>` after type arguments only on demand; anywhere else `!=` and `!==` stay equality operators. `EffectType` is an alternative of TypeScript's `Type`, beside a function type and a conditional type. A function or constructor type's return is a `Type`, so `() => A!E` is `() => (A!E)`, as `() => A | B` is `() => (A | B)` (VIP-3, amended). `!` does not mix with `|`, `&` or conditional types without parentheses (VIP-3, amended): an `EffectType` can't be an operand of `|` or `&` or a part of a conditional type unless parenthesized, and a function or constructor type in a slot needs its own parentheses (`A!(() => B)`, not `A!() => B`). Each is a syntax error with a quick fix that parenthesizes (`EK0301`). `A!!B!C` is `EK0302`. Each operand sits at the type-operator level, so prefix and postfix operators bind tighter than `!`.

A `!` after a type with no slot and no second `!` after it on its line is a syntax error, as in TypeScript (TS17019); the quick fix parenthesizes: `(x as Foo)!`. `T!!` is always an `EffectType`.

```text
service S {                       two members: R can't start on the next line
  now(): number!!
  later(): number!! }
effect function f(): number!! {   "{" begins the body, not R
const e: User!                    syntax error: NotFound starts a new line, so this ! has no slot
  NotFound = load()
const e: User!(                   one type: the slot starts on the line of its !
  NotFound | Timeout) = load()
const e: User!!= load()           const e: User!! = load()
x as number !== 0                 (x as number) !== 0, as in TypeScript
type T = A | B!E                  syntax error; write (A | B)!E or A | (B!E)
keyof A!E                         (keyof A)!E
A!E[]                             A!(E[]); write (A!E)[] for an array of Effects
User!![]                          Effect.Effect<User, never, []>; write (User!!)[] for an array
type Find = (id: string) => User!NotFound      (id: string) => Effect.Effect<User, NotFound>
type New = new () => User!NotFound             a constructor type returning an Effect
type G = () => A!E | B                         syntax error: ! mixed with |
A!(() => B)                       Effect.Effect<A, () => B>
X extends Y ? A!E : B             syntax error; write X extends Y ? (A!E) : B
A!E extends X ? 1 : 2             syntax error; write (A!E) extends X ? 1 : 2
x as Foo!;                        syntax error, as in TypeScript; write (x as Foo)!
x as Foo!!;                       x as Effect.Effect<Foo>
```

`(A | B)!E` is `Effect.Effect<A | B, E>`; `A | (B!E)` is `A | Effect.Effect<B, E>`.

**Fields.** A field's `Type` is parsed greedily, as in a TypeScript type member; then the field ends at `;`, `,`, a line break or `}`, so `{ a: string b: number }` is a syntax error and a union may continue on the next line:

```text
schema User { role:             one field, role: "admin" | "user"
  | "admin"
  | "user" }
```

A variant's `{` may follow a line break, as an error body's may; a line break before `{` is not a separator, so `data D { A` then `{ x: string } }` gives `A` the field `x`. `readonly` is allowed on any field; `error` and `data` fields are readonly either way. `data Empty {}` has no variants; it is an empty `Data.TaggedEnum`.

**Declarations.** `ClassHeritage` is TypeScript's class heritage, `extends` and `implements` clauses. `ServiceDeclaration`, `ErrorDeclaration` and `SchemaErrorDeclaration` are deliberately wider than the language, so `service Repo<T> { }`, `service S extends Base { }`, `error E<T> { }` and `error E { static x = 1 }` reach the coded static rules of [Failures](003-failures.md#error-declarations) and [Services](005-services.md#static-rules) instead of a generic syntax error. The alternatives don't overlap: a member that parses as a `Field`, `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` is that member, never a rejected one, so `service S { a: number, b: string }` uses interface separators. `ClassMethod` includes ordinary TypeScript method overloads, getters and setters, with their class modifiers and decorator checks. A getter is accepted and the setter rule rejects a setter; a constructor parses as `RejectedElement` but gets the specific constructor diagnostic before the catch-all row. `EffectMethod` and `ProducerMethod` start with `effect` and a name, which no ordinary `ClassMethod` does (`effect() { }` is a method named `effect`). A `ClassMethod`, `EffectMethod` or `ProducerMethod` in an error body follows TypeScript's class-method checks (`private m()`, `protected`, `override`), as any class can (VIP-13); a `static` one is rejected by the `static` rule. A member gets one diagnostic: the first row of its chapter's table that names it; the `RejectedElement` or `RejectedMember` row applies only when no other row does, and a member that a [Functions](001-functions.md) `effect` rule rejects (`effect get`, `effect set`, `effect constructor`) gets the applicable Functions diagnostics, with no extra error-body category diagnostic.

```text
error E { id: string }            a Field
error E { id = "init" }           RejectedElement: an initializer
error E { private id: string }    RejectedElement: a modifier other than readonly
error E { get message() { } }     a ClassMethod (a getter)
error E { effect again() { } }    an EffectMethod
error E { m() { }; id: string }   a ClassMethod, the empty element ";", a Field
error E { effect get x() { } }    an EffectAccessor: the getter/setter rule alone
service S { a: number b: string } EK0908: no separator; write ; or a line break
error E { a: number b: string }   EK1306: no separator; write ; or a line break
error E implements I { }          parses; an implements clause is rejected
service S { static readonly key = "k" }   a KeyMember
service S { static readonly key: string = "k" }   a KeyMember
service S { static readonly key = `k` }   RejectedMember: not a string literal
service S { (x: number): string }   RejectedMember: a call signature
service S { static key = "k" }    RejectedMember: not a KeyMember
service S { x: number = 1 }       RejectedMember: an initializer
```

**Match arms.** [MatchArm](#matcharm) is the pinned draft's clause with VIP-7's `when` prefix and VIP-5's `throw` arm body. `default` is last, guards belong to `MatchPattern`, and every arm ends with `;`, the last one included; a newline is not a separator.

## Appendix B. Diagnostics

Every diagnostic has an `EK` code and a message that says how to fix it (VIP-34). VibeLang's own rules take one hundred-block per VIP, `EK` then the two-digit VIP number then two digits, so VIP-19's rules are `EK19xx` (VIP-34, amended). Imported lint rules use the growing `EK38` decimal suffix below (VIP-34, amended). A code assigned before that scheme is kept where its rule is unchanged, or only widened or downgraded: `EK2109`, `EK2111`, `EK2117`, `EK2126`, `EK3001` to `EK3005`, `EK4402`, `EK4609`, `EK4610` and `EK4701`. Codes are unique across the table, so a kept code may sit inside another VIP's block. Each rule's chapter links to its definition. A row whose rule starts "warning" or "lint warning" is a warning; every other code is an error. Only a warning's code, or an `EK38xx` code, may appear in `vibe.severities` (VIP-30, amended): `{ "EK0801": "off" }` is valid, `{ "EK4701": "off" }` is `EK3006`. Reused numbers: `EK2001` to `EK2005`, `EK2102` to `EK2104`, `EK3006`, `EK3007` and `EK3201` previously named different rules in the [old language’s diagnostic table](https://github.com/smithersai/vibelang/blob/main/docs/design/history/src/428-part4-ch28-tooling.md); in this table they mean only the rows below. `EK3008` is not reused: `0.0.10`'s static-key rule is now `EK0901`. VibeLang's own syntax errors have codes too, each in its VIP's block (`EK0509`, `EK1906`, `EK2005`, …). TypeScript's own diagnostics keep their `TS` codes. Diagnostic ownership follows the source rule, not the parser helper: new VibeLang productions, placement rules, adopted proposal early errors and explicit reconciliations use their owning VIP's `EK` code. Imported proposal syntax is not ordinary native TypeScript syntax. Independent errors in native embedded expressions and types keep their native diagnostics. Each Effect language-service rule that VIP-38 imports (`effecttsgo/*`) gets one stable `EK38xx` code, listed in a table generated from the pinned effect-tsgo version; the CLI prints the code and the rule name (`EK3801 floatingEffect: …`), a VIP-32 bump regenerates the table, and a code never changes once assigned. Every `EK38xx` code is a lint code that `vibe.severities` may set to any value, `"off"` included (VIP-38, amended). The [Imported lint codes](#imported-lint-codes) table below is generated from that pin.

The old `EK2101` is retired and will never be reassigned: it rejected a bodyless declaration whose return type was not an Effect, a restriction VIP-9 removed.

The TypeScript-form lint warnings also retain their existing `EK4830`–`EK4837`, `EK4839`, `EK4841` and `EK4842` assignments. Their triggers and safe repairs are in [TypeScript spellings with VibeLang forms](007-tooling.md#typescript-spellings-with-vibelang-forms). They are configurable warnings, separate from the imported Effect rules and their `EK38xx` codes. Obsolete owned-fiber, Option extension-method and magic-entry rules have no rows here.

| Code | Rule | VIP | Chapter |
| --- | --- | --- | --- |
| `EK0101` | `effect f() { }` or `async f() { }` outside a class or object literal | 1 | [Functions](001-functions.md#effect-functions) |
| `EK0102` | `await`, `for await` or `await using` in effect code, or `await` in directly evaluated formal-parameter initialization of an Effect function, arrow, method or producer | 1 | [Functions](001-functions.md#static-rules) |
| `EK0103` | `await` on an Effect in an `async` function or at the module top level | 1, 5 | [Functions](001-functions.md#static-rules) |
| `EK0104` | `effect` on a getter, setter or constructor | 1 | [Functions](001-functions.md#static-rules) |
| `EK0105` | `effect` and `async` on one function or block | 1 | [Functions](001-functions.md#static-rules) |
| `EK0106` | an `effect` function whose written return type is not an Effect | 1 | [Functions](001-functions.md#static-rules) |
| `EK0107` | `eval`, `Function`, `arguments`, `var` or `with` in a `.vibe` file; `globalThis` other than as the object of a statically named member; `.constructor` of a function; a `data:` or `blob:` import specifier; `var` in a pattern binding | 1, 4, 33 | [Functions](001-functions.md#direct-eval) |
| `EK0108` | a recognized `effect` modifier on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member | 1 | [Functions](001-functions.md#static-rules) |
| `EK0201` | a `do` block whose last statement violates TC39's `EndsInIterationOrBareIfOrDeclaration` early error | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0202` | a `break` or `continue` whose target is outside the block of an `effect { … }` expression | 2 | [Running Effects](002-running.md#effect-blocks) |
| `EK0203` | `var` in a `do` expression in a parameter list | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0204` | current compiler implementation limitation: an outward source completion cannot yet cross a generated function boundary in this position; this is not a TC39 early error | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0205` | a `break` or `continue` in a loop head's `do` that leaves it unlabeled or targets that loop | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0301` | `!` beside a union, an intersection, a conditional type, or a function or constructor type in a slot, without parentheses: `A \| B!E`, `() => A!E \| B`, `A!() => B` (write `A!(() => B)`) | 3 | [Functions](001-functions.md#the-aer-type-shorthand) |
| `EK0302` | `A!!B!C`: write `(A!!B)!C` or `A!(B!C)` | 3 | [Appendix A](#notes-on-the-productions) |
| `EK0401` | a `throw` or a call that may throw in a plain function whose return type is effectful, or a parameter default that may throw in any effectful function, or a local implementation whose tracked throws exceed an exposed effectful overload's implicit `never` bound | 4 | [Failures](003-failures.md#effectful-callables) |
| `EK0402` | a function that may throw where a function type doesn't admit its thrown type | 4, 39 | [Failures](003-failures.md#assignability) |
| `EK0403` | an unwrapped call, `new` expression, tagged template or class evaluation that may throw, in effect code or a plain `catch` handler | 4 | [Failures](003-failures.md#calls-in-effect-code) |
| `EK0404` | an unwrapped Promise-producing call (runtime `import()` included), `new` expression, tagged template or `async match` in effect code | 4, 5 | [Failures](003-failures.md#calls-in-effect-code) |
| `EK0405` | a body that throws more than its written `@throws {T}` | 4 | [Failures](003-failures.md#thrown-types) |
| `EK0406` | a `@throws` or `@rethrows` tag on an effectful `.vibe` callable: an `effect` function, arrow, method or producer, or a callable whose return type is wholly `Effect`, `Stream` or `Layer`; quick fix: remove the tag | 4 | [Failures](003-failures.md#thrown-types) |
| `EK0501` | `try` outside effect code, the top level included; the same rule applies to `try.all`, `try.race`, `try.any` or `try.allSettled` | 5, 18, 9 | [Running Effects](002-running.md#try) |
| `EK0502` | `try` on a value that is not an Effect | 5 | [Running Effects](002-running.md#try) |
| `EK0503` | a `try` statement in effect code | 5 | [Running Effects](002-running.md#try) |
| `EK0504` | `catch` outside effect code | 5 | [Running Effects](002-running.md#catch) |
| `EK0505` | `try x catch h`: a `try`, `try.all` (or another await operation), `fork` or `join` reachable from a `catch` head through unary and binary operator nodes only | 5, 17 | [Running Effects](002-running.md#catch) |
| `EK0506` | `e catch h` where `e` is not an Effect | 5, 17 | [Running Effects](002-running.md#catch) |
| `EK0507` | a plain handler whose result is a Promise or thenable | 5 | [Running Effects](002-running.md#catch) |
| `EK0508` | lint warning: a plain handler whose result is an Effect; use `catch effect` | 5, 38 | [Running Effects](002-running.md#catch) |
| `EK0509` | a `catch` handler that is not a plain or `effect` arrow or function expression: `a catch b`, `a catch effect { }`, `a catch async (e) => b`, `a catch function* (e) { }`; a parameter list followed directly by a block, as in `try x catch (e) { }`, gets `EK0509` without adding `EK0505` for the same malformed handler | 5 | [Running Effects](002-running.md#catch) |
| `EK0510` | an unparenthesized `try`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` expression on the left of `**`, as ECMAScript rejects `await a ** b`; parenthesize it: `(try a) ** b` | 5, 17, 18 | [Running Effects](002-running.md#static-rules) |
| `EK0511` | lint warning: an explicit `throw` that can complete a plain `catch` handler, not one caught inside it or in a nested function; use `catch effect` | 5, 38 | [Running Effects](002-running.md#catch) |
| `EK0701` | a missing `;` after a `match` arm, the last one included | 7 | [Pattern matching](004-match.md#syntax-and-meaning) |
| `EK0702` | a class pattern that [Class patterns](004-match.md#class-patterns) rejects: it names a `data` declaration or variant, a `schema` or a directly built `Context.Reference`, or its callee has no usable signature or return type (a `service` is `EK3004`) | 7 | [Pattern matching](004-match.md#class-patterns) |
| `EK0703` | lint warning: an extractor whose argument count can never match its pattern's list, `when NotFound():` | 7, 38 | [Pattern matching](004-match.md#class-patterns) |
| `EK0704` | an extractor `when C(…)`, `C()` included, on an ordinary class without its own `Symbol.customMatcher` (an inherited one does not count); write `when C:` or `when C and { x: let x }:` (VIP-7, amended) | 7 | [Pattern matching](004-match.md#class-patterns) |
| `EK0705` | an `is` lexical binding that would need formal-parameter initialization as its home; use an explicit local block preserving the intended result and call phase; also a binding in an `enum` member initializer, which has no lexical home | 7 | [Pattern matching](004-match.md#is-bindings-in-parameter-initialization) |
| `EK0706` | a `return`, `break` or `continue` that leaves an `async match`; a nested function keeps its own `return` | 7 | [Pattern matching](004-match.md#async-match-jumps) |
| `EK0707` | invalid `match`/`is` grammar or a pattern-specific early error without a more specific assigned diagnostic; includes an interpolated primitive template pattern | 7 | [Pattern matching](004-match.md#syntax-and-meaning) |
| `EK0801` | warning: `using` in effect code; use `acquireDisposable` inside `scoped` | 8 | [Runtime](008-runtime.md) |
| `EK0901` | a `static key` without `readonly`, or whose initializer is not a string literal | 9 | [Services](005-services.md#static-rules) |
| `EK0902` | a service member that is not a `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` | 9 | [Services](005-services.md#static-rules) |
| `EK0903` | a service with no derived key and no `static readonly key` | 9 | [Services](005-services.md#static-rules) |
| `EK0904` | an `extends` or `implements` clause on a service: `service S extends Base { }` | 9 | [Services](005-services.md#static-rules) |
| `EK0905` | `export default service S { }`; write `export { S as default }` | 9 | [Services](005-services.md#static-rules) |
| `EK0906` | a recognized service declaration missing its required body | 9 | [Services](005-services.md#static-rules) |
| `EK0907` | a custom `service` declaration in a native ambient source context, explicit or inherited; includes `declare service`, ahead of the same missing-body recovery | 9 | [Services](005-services.md#static-rules) |
| `EK0908` | two `service` members with no separator between them, such as `a: number b: string` on one line; write `;` or a line break between them (quick fix: insert `;`) | 9 | [Services](005-services.md#static-rules) |
| `EK1101` | a trailing block: a `{` on the same line after a name, a property access or a call, `f(x) { … }` or `f { … }`, outside a heritage clause and a `provide` block's providers, where no TypeScript or VibeLang production admits the `{` (so `effect { … }`, `match (x) { … }`, `namespace A.B { … }` and declaration heads such as `service S { … }` are not trailing blocks); quick fix: pass the block as the call's last argument, `f(x, effect { … })` where it ran as a program, `f(x, effect () => { … })` where it ran as an Effect function, `f(x, () => { … })` otherwise | 11 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK1201` | `provide` outside effect code | 12 | [Services](005-services.md#provide-blocks) |
| `EK1202` | a line break immediately before or after a top-level provider-separating `,` | 12 | [Services](005-services.md#provide-blocks) |
| `EK1301` | a constructor in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1302` | a user-written `static` member or setter in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1303` | type parameters on an `error` or `schema error` declaration | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1304` | any other `RejectedElement` in an `error` or `schema error` body; an `implements` clause | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1305` | `export default error E` or `export default schema error E`; write `export { E as default }` | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1306` | two `error` or `schema error` body members with no separator between them; write `;` or a line break between them (quick fix: insert `;`) | 13 | [Appendix A](#separator) |
| `EK1401` | a namespace name that two subpaths export, or a subpath and the root | 14 | [Services](005-services.md#the-platform-standard-library) |
| `EK1501` | `export default schema S …`; write `export { S as default }` | 15 | [Data](006-data.md#schema-declarations) |
| `EK1502` | type parameters on a `schema` declaration; use an ordinary generic TypeScript factory | 15 | [Data](006-data.md#schema-declarations) |
| `EK1503` | a recognized ordinary schema declaration missing its required body or admitted alias form | 15 | [Data](006-data.md#schema-declarations) |
| `EK1504` | two `schema` fields with no separator between them; write `;` or a line break between them (quick fix: insert `;`) | 15 | [Data](006-data.md#schema-declarations) |
| `EK1601` | a `data` variant field named `_tag` | 16 | [Data](006-data.md#data-declarations) |
| `EK1603` | `export default data D { … }`; write `export { D as default }` | 16 | [Data](006-data.md#data-declarations) |
| `EK1602` | a `data` variant named `$is` or `$match`; rename it and its resolved references | 16, 28 | [Data](006-data.md#data-declarations) |
| `EK1604` | a recognized data declaration missing its required variant body | 16 | [Data](006-data.md#data-declarations) |
| `EK1605` | two variants of a `data` declaration, or two fields of a variant, with no separator between them; write `;` or a line break between them (quick fix: insert `;`) | 16 | [Data](006-data.md#data-declarations) |
| `EK1701` | `fork` or `join` outside effect code | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1702` | `fork` or `join` as a variable, parameter or label name in effect code, in the parameters of an `effect` function, arrow, method or producer, or in a plain or `async` arrow head inheriting that reservation, including one in an Effect callable's parameters; the arrow body has its own context; or a reserved `fork` or `join` as a shorthand property, `{ join }` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1703` | a `fork`, `fork.in(s)`, `fork.scoped` or `fork.detached` operand that fails the operand test of `try` | 5, 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1704` | a `join` operand not assignable to `Fiber.Fiber<any, any>` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1705` | a `fork.` owner other than `in(s)`, `scoped` or `detached`: `fork.other e` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1706` | a `fork.in(s)` scope operand not assignable to `Scope.Scope` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1801` | an operand that is not an array of Effects, for `try.all`, `try.race`, `try.any` or `try.allSettled` | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1802` | a retired `await.all`, `await.race`, `await.any` or `await.allSettled`; quick fix: the `try` operation that replaces it | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1803` | a name after `try.` other than `all`, `race`, `any` or `allSettled`: `try.map x` | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1901` | a `for concurrent` operand that is not an `Iterable` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1902` | `for concurrent` outside effect code | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1903` | `break` leaving head binding initialization or the body of `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1904` | `return` in head binding initialization or the body of `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1905` | a labeled `continue` naming a statement that encloses the `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1906` | a `var`, `using`, `await using` or assignment head in `for concurrent`: any head other than a `const` or `let` declaration | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1907` | a `for concurrent` limit not assignable to `Types.Concurrency` (`number \| "unbounded"`) | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK2001` | `for try` outside effect code | 20 | [Running Effects](002-running.md#for-try) |
| `EK2002` | `return` in head binding initialization or the body of `for try` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2003` | a labeled `break` or `continue` from `for try` head binding initialization or the body to a statement that encloses the `for try`; one naming the `for try` itself is its unlabeled `break` or `continue` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2004` | a `for try` operand that is not a `Stream` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2005` | a `var`, `using`, `await using` or assignment head in `for try`: any head other than a `const` or `let` declaration | 20 | [Running Effects](002-running.md#for-try) |
| `EK2007` | a legacy `for...of` or `for await` loop over a `Stream`; migrate it to `for try` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2102` | a producer whose written return type is not a `Stream` | 21 | [Running Effects](002-running.md#producers) |
| `EK2103` | `yield*` in a producer | 21 | [Running Effects](002-running.md#producers) |
| `EK2104` | `yield` in nonproducer effect code (an `effect` function, arrow or block), whether or not an outer producer exists, or in directly evaluated formal-parameter initialization of an Effect callable or producer | 21 | [Running Effects](002-running.md#producers) |
| `EK2109` | a `schema` field type outside the mapping (including a shadowing type without a suitable Schema value), or conflicting/unprovable referenced-schema decoded-key flags at a required or effectively readonly position | 15 | [Data](006-data.md#schema-declarations) |
| `EK2111` | `restore` outside an `uninterruptible` block | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2117` | an `extends` clause or a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `"_tag"` | 13 | [Failures](003-failures.md#error-declarations) |
| `EK2126` | a constraint on a generic `data` type parameter | 28 | [Data](006-data.md#generic-unions) |
| `EK2128` | `return value` in a producer: a Stream has no return value; write a bare `return` to end the stream | 21 | [Running Effects](002-running.md#producers) |
| `EK2201` | an interruption block outside effect code | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2202` | `restore` that captures an outer mask across an independent `effect` function, arrow, method, producer or block, or `restore` in any `for concurrent` body | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2301` | an unparenthesized conditional at either end of a pipe, `x \|> f(%) ? a : b`: the pinned proposal's conditional-body error and a pipe as a conditional's test; write `(x \|> f(%)) ? a : b` to test the result or `x \|> (f(%) ? a : b)` to pipe into the conditional | 23 | [Running Effects](002-running.md#the-pipe-operator) |
| `EK2801` | a `data` declaration with more than 4 type parameters | 28 | [Data](006-data.md#generic-unions) |
| `EK2803` | a default on a generic `data` type parameter | 28 | [Data](006-data.md#generic-unions) |
| `EK3001` | two services with the same key | 9 | [Services](005-services.md#static-rules) |
| `EK3002` | a class extends a service | 9 | [Services](005-services.md#static-rules) |
| `EK3003` | `new` on a service | 9 | [Services](005-services.md#static-rules) |
| `EK3004` | `instanceof` a service, or a class pattern naming any `service` declaration, with or without `defaultValue` | 7, 9 | [Services](005-services.md#static-rules) |
| `EK3005` | a generic service, or a service whose resolved member contracts capture an outer type parameter | 9 | [Services](005-services.md#static-rules) |
| `EK3006` | an error code or an unknown code in `vibe.severities`, or a severity entry whose value is not one of the four strings, whatever its JSON type | 30 | [Configuration and tooling](007-tooling.md) |
| `EK3007` | an unknown `vibe` key, or a `vibe` value of the wrong type other than a `severities` entry (`EK3006`), including a `severities` value that is not an object | 30 | [Configuration and tooling](007-tooling.md#config-files) |
| `EK3009` | warning: root `vibelang.diagnostics` or `compilerOptions.vibelang.diagnostics` in any supported config or extended config needs migration; supported legacy settings still apply, modern entries win, and `--fix` migrates eligible maps | 30 | [Legacy severity maps](007-tooling.md#legacy-severity-maps) |
| `EK3201` | a resolved `effect` version other than the pin | 32 | [Configuration and tooling](007-tooling.md#the-effect-version) |
| `EK4402` | a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), a string-literal `import(…)` of one, or a statically named value that [reaches the platform](005-services.md#reaches-the-platform): a global declared by `lib.dom`, `lib.webworker`, `lib.scripthost` or `@types/node` and not by `lib.es*` or `lib.decorators*`, minus the allowlist, or a banned member of an allowlisted global, in a `.vibe` file | 33 | [Services](005-services.md#the-platform-standard-library) |
| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; to obtain its result in that context, use `await runPromise(Fiber.join(fiber))` | 5 | [Running Effects](002-running.md#await) |
| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; to obtain its result in that context, use `await runPromise(Deferred.await(deferred))` | 5 | [Running Effects](002-running.md#await) |
| `EK4701` | a `match` with no `default` whose subject passes the exhaustiveness check and misses a case; a guarded arm covers nothing | 7 | [Pattern matching](004-match.md#exhaustiveness) |
| `EK4802` | warning: an `effect` function returns an Effect value unrun, so its caller gets the program instead of its result; a project where `--fix-vip-only` refused a call sets it to `"error"` | 1, 5 | [Configuration and tooling](007-tooling.md#effects-type-aware-lint) |
| `EK4830` | lint warning: A class written with `Data.TaggedError("Name")` | 13, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4831` | lint warning: A class written with `Context.Service` | 9, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4832` | lint warning: A `const` holding `Schema.Struct({ … })` | 15, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4833` | lint warning: A written `Effect.Effect<A, E, R>` type | 3, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4834` | lint warning: An explicitly run `Effect.succeed(v)` or `Effect.fail(e)` in effect code | 4, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4835` | lint warning: An explicitly run `Effect.catch`, `Effect.catchTag`, or `Effect.catchTags` in effect code | 5, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4836` | lint warning: An explicitly run `Effect.provide` or `Effect.provideService` in effect code | 12, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4837` | lint warning: A class written with `Schema.TaggedError` | 29, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4839` | lint warning: An Effect `Match` chain with a supported finisher, or a direct `Option.match(value, handlers)` call | 7, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4841` | lint warning: A schema `const` immediately followed by its matching `typeof Name.Type` alias | 15, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4842` | lint warning: An Effect module imported under a conflicting JavaScript global name | 14, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |

### Transitional compiler diagnostics

A transitional compiler may still print compatibility diagnostics from the old language. The following inventory covers the `EK92xx` codes in its [registry](../../../typescript/tsc/internal/vibelang/diagnostics.go), separately from the normative rules above: an interim code does not establish a language rule or reserve a new VIP block. Their retirement follows the named VIPs; a compiler renumbering must update this inventory with the registry.

| Emitted code | Rule | Retirement VIP | Replacement |
| --- | --- | --- | --- |
| interim `EK9201` | error: an expected failure escapes the written error contract | 1, 3 | Ordinary checked Effect return types and assignability |
| interim `EK9202` | error: a requirement escapes the written requirement contract | 1, 3 | Ordinary checked Effect return types and assignability |
| interim `EK9203` | error: a plain return annotation is on a function or native generator whose body runs an Effect or can fail | 1, 4 | Keywords decide function kind; ordinary JavaScript throws follow the accepted thrown-type rules |
| interim `EK9204` | warning: an old Effect `try`/`catch` statement has no expected errors, or the head of a `catch` expression cannot fail, reported at its `catch` keyword | 5 | Statement: Effect code has no `try` statement (`EK0503`); an infallible Effect is still run with `try e`. Expression: `succeed(2) catch (e) => 0` is valid; the warning retires with no successor |
| interim `EK9205` | error: a declaration without a body has a return type that is not an Effect | 1, 9 | Ordinary TypeScript declarations and service members may have non-Effect return types; an omitted service method or property type follows native `noImplicitAny` (`TS7010`/`TS7008`), not this interim rule |
| interim `EK9206` | error: a recursive function has a success type that depends on its own result, or the legacy partial-contract inference cannot break its call cycle | 1, 3 | Ordinary TypeScript inference and its own recursion diagnostics; no VibeLang recursion diagnostic |
| interim `EK9207` | error: a service or control contract member has a body or initializer, or an instance member is placed in a legacy shape-only service body | 9 | Accepted service-member restrictions use `EK0902`; control syntax remains historical, not an accepted construct |
| interim `EK9208` | error: a static service member has the same name as an instance service member | 9 | Accepted service shapes and their restricted static members follow the ordinary `Context.Service` counterpart |

For example, `effect function bad(): number!! { throw new Bad() }`, with `error Bad`, fails ordinary Effect return-type checking: its error type is `Bad`, rather than `never`. `effect function run() { return try succeed(1) }` is valid and gives `Success(1)`. Removing the old statement warning never permits skipping an infallible Effect.

The compiler also still prints `EK3008` for `0.0.10`'s static-key rule, which the normative table numbers `EK0901`; read an emitted `EK3008` as `EK0901` until the compiler is renumbered.

The existing migration warnings retain their emitted codes until the compiler and documentation move together. They select repairs; they do not change the omitted-slot or service rules.

| Code | Rule | VIP | Chapter |
| --- | --- | --- | --- |
| `EK4853` | warning: migration of an omitted requirement slot: write the previously inferred requirements explicitly, or omit the whole return annotation to infer the contract | 3 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4854` | warning: migration of the retired abstract-class service spelling to a `service` declaration, retaining its contract and key | 9 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4855` | warning: migration of `static readonly default = shape` to `static readonly defaultValue = () => shape`, including the corresponding type and value reads | 9 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4856` | warning: a type use resolves to the retired global `Effect<A, E, R>` alias; write `A!E!R` or `Effect.Effect<A, E, R>`; local and imported types are unchanged | 3, 14, 34 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |

An abstract class retains ordinary TypeScript class semantics until explicitly migrated. A migrated service default is a factory of type `() => Shape`; these warnings use the existing safe codemod and its refusal rules ([Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements)).

### Imported lint codes

The normative [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) and this table are generated by `node docs/tools/lint-codes.mjs --write` from the vendored [`UPSTREAM`](../../../typescript/tsc/internal/effecttsgo/UPSTREAM) pin (VIP-38; details 41, 60, 77, 98, 106 and 142). [Tooling](007-tooling.md) defines severity precedence and the append-only `EK38` allocation. The decimal suffix grows past two digits when necessary; removed rule names keep their reserved codes. Codes compare as whole strings, so `EK3810` and `EK38100` are distinct; no `EK39xx` block is reserved, because that block belongs to VIP-39.

<!-- lint-codes:start: generated by docs/tools/lint-codes.mjs; do not edit -->

Imported rules from `@effect/tsgo@0.57.0` (commit `999942fa41462eb46dfcb2d718e7671db8e14156`).

| Code | Rule | VIP | Chapter | Default severity |
| --- | --- | --- | --- | --- |
| `EK3802` | `effecttsgo/abortControllerInEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3803` | `effecttsgo/acquireReleaseDisposable` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3804` | `effecttsgo/allOfMapToForEach` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3805` | `effecttsgo/anyUnknownInErrorContext` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3806` | `effecttsgo/apiStabilityLeak` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3807` | `effecttsgo/asyncFunction` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3808` | `effecttsgo/catchAllTagDispatchToCatchTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3809` | `effecttsgo/catchAllToMapError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3810` | `effecttsgo/catchChainToFirstSuccessOf` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3811` | `effecttsgo/catchConditionalRefailToCatchIf` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3812` | `effecttsgo/catchDieToOrDie` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3813` | `effecttsgo/catchIfTagToCatchTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3814` | `effecttsgo/catchRefailToTapError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3815` | `effecttsgo/catchTagToCatchReason` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3816` | `effecttsgo/catchToIgnore` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3817` | `effecttsgo/catchToOrElseSucceed` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3818` | `effecttsgo/catchUnfailableEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3819` | `effecttsgo/classSelfMismatch` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3820` | `effecttsgo/cryptoRandomUUID` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3821` | `effecttsgo/cryptoRandomUUIDInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3822` | `effecttsgo/deterministicKeys` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3823` | `effecttsgo/duplicatePackage` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3824` | `effecttsgo/effectDoNotation` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3825` | `effecttsgo/effectFnIife` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3826` | `effecttsgo/effectFnImplicitAny` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3827` | `effecttsgo/effectFnOpportunity` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3828` | `effecttsgo/effectGenUsesAdapter` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3829` | `effecttsgo/effectInFailure` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3830` | `effecttsgo/effectInVoidSuccess` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3831` | `effecttsgo/effectMapFlatten` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3832` | `effecttsgo/effectMapVoid` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3833` | `effecttsgo/effectSleepZeroToYieldNow` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3834` | `effecttsgo/effectSucceedWithVoid` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3835` | `effecttsgo/errorPayloadShadowsName` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3836` | `effecttsgo/experimentalApiUsage` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3837` | `effecttsgo/extendsNativeError` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3838` | `effecttsgo/flatMapConditionalToFilterOrFail` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3839` | `effecttsgo/flatMapIgnoredParamToAndThen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3840` | `effecttsgo/flatMapToMap` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3841` | `effecttsgo/flatMapToTap` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3801` | `effecttsgo/floatingEffect` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3842` | `effecttsgo/floatingEffectInVitest` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3843` | `effecttsgo/genericEffectServices` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3844` | `effecttsgo/globalConsole` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3845` | `effecttsgo/globalConsoleInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3846` | `effecttsgo/globalDate` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3847` | `effecttsgo/globalDateInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3848` | `effecttsgo/globalErrorInEffectCatch` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3849` | `effecttsgo/globalErrorInEffectFailure` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3850` | `effecttsgo/globalFetch` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3851` | `effecttsgo/globalFetchInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3852` | `effecttsgo/globalRandom` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3853` | `effecttsgo/globalRandomInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3854` | `effecttsgo/globalTimers` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3855` | `effecttsgo/globalTimersInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3856` | `effecttsgo/instanceOfSchema` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3857` | `effecttsgo/layerMergeAllWithDependencies` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3858` | `effecttsgo/lazyEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3859` | `effecttsgo/lazyPromiseInEffectSync` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3860` | `effecttsgo/leakingRequirements` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3861` | `effecttsgo/mapSomeToAsSome` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3862` | `effecttsgo/matchEffectToMapBoth` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3863` | `effecttsgo/matchEffectToMatch` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3864` | `effecttsgo/missedPipeableOpportunity` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3865` | `effecttsgo/missingEffectContext` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3866` | `effecttsgo/missingEffectError` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3867` | `effecttsgo/missingEffectServiceDependency` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3868` | `effecttsgo/missingLayerContext` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3869` | `effecttsgo/missingPipeableSignature` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3870` | `effecttsgo/missingReturnYieldStar` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3871` | `effecttsgo/missingStarInYieldEffectGen` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3872` | `effecttsgo/multipleCatchTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3873` | `effecttsgo/multipleEffectProvide` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3874` | `effecttsgo/nestedEffectGenYield` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3875` | `effecttsgo/newPromise` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3876` | `effecttsgo/newSchemaClass` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3877` | `effecttsgo/nodeBuiltinImport` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3878` | `effecttsgo/nonObjectEffectServiceType` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3879` | `effecttsgo/obsoleteMatchImport` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3880` | `effecttsgo/obsoleteSchemaImport` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3881` | `effecttsgo/optionMatchToFromOption` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3882` | `effecttsgo/outdatedApi` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3883` | `effecttsgo/overriddenSchemaConstructor` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK3884` | `effecttsgo/preferBarrelImport` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3885` | `effecttsgo/preferEffectArray` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3886` | `effecttsgo/preferEffectRecord` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3887` | `effecttsgo/preferEffectString` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3888` | `effecttsgo/preferNamespaceImport` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3889` | `effecttsgo/preferSchemaOverJson` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3890` | `effecttsgo/preferSchemaTaggedError` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3891` | `effecttsgo/preferSchemaTypeProperty` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3892` | `effecttsgo/preferSucceedSomeOrNone` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3893` | `effecttsgo/preferTypedSchemaDecoder` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3894` | `effecttsgo/preferUnsafeConstructor` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3895` | `effecttsgo/processEnv` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3896` | `effecttsgo/processEnvInEffect` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK3897` | `effecttsgo/promiseInEffectSuccess` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK3898` | `effecttsgo/provideLayerSucceedToProvideService` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK3899` | `effecttsgo/raceFirstWithSleepToTimeout` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38100` | `effecttsgo/redundantMapError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38101` | `effecttsgo/redundantOrDie` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38102` | `effecttsgo/redundantSchemaTagIdentifier` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38103` | `effecttsgo/returnEffectInGen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38104` | `effecttsgo/runEffectInsideEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38105` | `effecttsgo/runOfExitToRunExit` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38106` | `effecttsgo/schemaClassMissingBrand` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38107` | `effecttsgo/schemaClassObjectLiteral` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK38108` | `effecttsgo/schemaLiteralNonFinite` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK38109` | `effecttsgo/schemaNumber` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38110` | `effecttsgo/schemaOpaqueInstanceMember` | 38 | [Tooling](007-tooling.md) | `error` |
| `EK38111` | `effecttsgo/schemaStructWithTag` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38112` | `effecttsgo/schemaSync` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38113` | `effecttsgo/schemaSyncInEffect` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38114` | `effecttsgo/schemaUnionOfLiterals` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38115` | `effecttsgo/scopeInLayerEffect` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK38116` | `effecttsgo/serviceNotAsClass` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38117` | `effecttsgo/strictBooleanExpressions` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38118` | `effecttsgo/strictEffectProvide` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38119` | `effecttsgo/syncToSucceed` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38120` | `effecttsgo/timeoutCatchTagToTimeoutOrElse` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38121` | `effecttsgo/tryCatchInEffectGen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38122` | `effecttsgo/unknownInEffectCatch` | 38 | [Tooling](007-tooling.md) | `warning` |
| `EK38123` | `effecttsgo/unnecessaryArrowBlock` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38124` | `effecttsgo/unnecessaryEffectGen` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38125` | `effecttsgo/unnecessaryFailYieldableError` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38126` | `effecttsgo/unnecessaryPipe` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38127` | `effecttsgo/unnecessaryPipeChain` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38128` | `effecttsgo/unnecessaryTypeofType` | 38 | [Tooling](007-tooling.md) | `suggestion` |
| `EK38129` | `effecttsgo/unsafeEffectTypeAssertion` | 38 | [Tooling](007-tooling.md) | `off` |
| `EK38130` | `effecttsgo/unstableApiUsage` | 38 | [Tooling](007-tooling.md) | `warning` |

<!-- lint-codes:end -->

## Appendix C. Denied and open VIPs

### Denied VIPs

A denied VIP is not part of the language. Each records what was proposed and why it was denied.

| VIP | Denied | Instead |
| --- | --- | --- |
| [8](../vips/0008-using-denied.md) | special syntax for Effect resources (`using` with Effect meaning, a `scoped` keyword) | `using` is TypeScript's; Effect resources use `scoped(effect { … })` |
| [10](../vips/0010-service-call-shorthand-denied.md) | the `Users.find(id)` shorthand | `try (try Users).find(id)` |
| [11](../vips/0011-trailing-blocks-denied.md) | trailing blocks, `f(x) { … }` | `f(x, () => { … })`, `f(x, effect () => { … })` or `f(x, effect { … })`, as `EK1101`'s quick fix chooses |
| [24](../vips/0024-wire-denied.md) | `wire`, automatic layer composition | Effect's `Layer.provide` and `Layer.provideMerge` |
| [25](../vips/0025-inline-modules-denied.md) | inline `module` declarations as a TypeScript escape | a `.ts` file |

### Open VIPs

Listed for a future decision; not part of the language.

| VIP | Title |
| --- | --- |
| [35](../vips/0035-handlers-open.md) | Effect handlers (`control`, `handle`, `resume`, `abandon`) |
| [36](../vips/0036-manifest-open.md) | The declaration manifest |
| [37](../vips/0037-effectify-the-universe-open.md) | Effectify the universe |

The proposals page lists further ideas, each to get its own VIP: durable execution, compile-time evaluation, build-time host selection, validators derived from types, typed asset imports, custom loaders, Rust and Zig source imports, a coding-agent library, typed workers, shared structs, declarations in conditionals, toolchain commands, bundler plugins, mandatory compiler options and a TC39 adopt-early list.

## Appendix D. Flipping pending examples

Every VibeLang example in this specification starts with `// compiler-gap: pending VIP-N`, and every Effect TypeScript example that names functions it doesn't declare starts with `// fragment`. The snippet checker reports a `compiler-gap` block as a known gap, not a failure.

To check the specification's examples:

```sh
bun docs/tools/check-snippets.ts --root docs/design/src
```

When the compiler implements VIP-N:

1. Run the command above. A block whose marker is stale fails with "Stale compiler-gap marker; remove it": the compiler reports no code beyond the block's `// expect-error:` header, apart from names the block doesn't declare. The checker reads expected codes only from that header, not from trailing comments, so a stale result alone proves nothing about the codes a block's comments promise: `effect function n(): number { return 1 }   // EK0106` reports stale while the compiler prints no diagnostic for it.
2. Write every code the block's comments promise in an `// expect-error:` header, such as `// expect-error: EK0103, EK0106`, a syntax error's code included, and rerun. Delete the block's `// compiler-gap: pending VIP-N` line only if it still passes. If the block only names functions it doesn't declare (`fetchUser`), declare them in the block or a page fixture, or mark it `// fragment`.
3. When a page has no `compiler-gap` markers left, add `docs/design/src` to the snippet step of the merge queue's gate (`//:snippets`), so the examples stay checked.
4. To make an Effect TypeScript example checked, replace `// fragment` with the declarations it needs; the checker compiles ```` ```ts effect ```` blocks as comparisons.

## Appendix E. Shipped `@throws` and `@rethrows` annotations

These are the annotations [Thrown types](003-failures.md#thrown-types) refers to. VibeLang ships them for JavaScript's globals and for Effect's non-effectful exports, plus the thunk annotations of VIP-4's two wrappers. Every other callback parameter of any function, Effect's and the globals' alike, `LazyArg` included, is a function type with no `@throws`, so it admits only non-throwing functions: `sync(() => parse(s))` is an error; use `Effect.try`.

| Function | Annotation |
| --- | --- |
| `JSON.parse` | `@throws {SyntaxError}` |
| `Math.max`, `Date.now`, `Option.some` | `@throws {never}` |
| `Schema.decodeUnknownSync`, `Schema.decodeSync` | `@throws {never}`: they only build a decoder |
| the constructors of `Data.TaggedError` and `Data.taggedEnum` variants: `new NotFound({ id })`, `Delivery.Sent({ … })` | `@throws {never}` |
| the constructor of `Schema.TaggedError`: `new Invalid({ … })` for a `schema error` | `@throws {never}`, as for `error` and `data`: a bad field at construction throws a plain `Error`, a defect: `effect { throw new Invalid({ name: "" }) }` dies |
| the decoder that `Schema.decodeUnknownSync(schema)` or `Schema.decodeSync(schema)` returns | `@throws {SchemaError}` |
| the thunk of `Effect.try` and `tryPromise`, in either form: the function argument, or the `try` property of the options argument | `@throws {unknown}`: the wrapper makes a throw a failure. The options form's `catch` callback has no `@throws`. `promise`'s thunk has no `@throws`, so it admits only a thunk that throws `never` |
| `Array.prototype.map`, `.forEach`, `.filter`, `.find`, `.some`, `.every`, `.sort` | `@throws {never} @rethrows callbackfn` (`sort`: `@rethrows compareFn`) |
| `Array.prototype.reduce` | without `initialValue`: `@throws {TypeError} @rethrows callbackfn` (`[].reduce(f)` throws); with `initialValue`: `@throws {never} @rethrows callbackfn` |
| `Array.from` | `@throws {never} @rethrows mapfn` |
| the data-last overload of every dual export of effect 4.1.0: `map(f)`, `retry(p)`, `catchTag(t, h)` | `@throws {never}`: it only builds a function |
| `new Promise(executor)` | `@throws {never}`, no `@rethrows`: a throw in the executor rejects the Promise, as in JavaScript; it never throws at the construction site |
| the `executor` parameter's call signature | `@throws {unknown}`: it admits a throwing executor, whose throw becomes the rejection, not part of the constructor's thrown type |

In a `.ts` file, `setTimeout` does not rethrow, because it stores the callback; in a `.vibe` file it is a banned platform global ([Services](005-services.md#the-platform-standard-library)). A shipped annotation always carries `@throws`, so step 2 of [Thrown types](003-failures.md#thrown-types) always finds a type. The array annotations attach to every `lib.d.ts` call signature of the named method, on `Array<T>` and `ReadonlyArray<T>` alike; a tuple uses `Array<T>`'s. An Effect function's data-first overload returns an Effect and is effectful; its data-last overload returns a function and is non-effectful with `@throws {never}`, so `fetchUser(id).pipe(Effect.map(toDto), Effect.retry(policy))` is accepted. Their callbacks have no `@throws`. A library declares the same tags in its own declarations:

```ts
/** @throws {never} @rethrows f */
export declare function each<T>(xs: readonly T[], f: (x: T) => void): void
```

Apply the three-step procedure in [Thrown types](003-failures.md#thrown-types) to these shipped signature contracts. It composes own throws with `@rethrows` and preserves the effectful exemption (VIP-4, amended).

```vibe es
// compiler-gap: pending VIP-4
/** @throws {never} @rethrows f */
function each<T>(xs: readonly T[], f: (x: T) => void): void {
  xs.forEach(f)
}

effect function direct() {
  each([1], () => { throw "callback" }) // EK0403: wrap the call
}

effect function wrapped() {
  return try Effect.try({
    try: () => each([1], () => { throw "callback" }),
    catch: (e) => e
  })
}
```

The same contracts apply when `each` is imported through the declaration above. Its ordinary JavaScript call throws; `Effect.try` turns that throw into a typed failure:

```ts effect
import { Effect } from "effect"

/** @throws {never} @rethrows f */
function each<T>(xs: readonly T[], f: (x: T) => void): void {
  xs.forEach(f)
}

function wrapped() {
  return Effect.gen(function* () {
    return yield* Effect.try({
      try: () => each([1], () => { throw "callback" }),
      catch: (e) => e
    })
  })
}
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

A throwing executor is accepted, in a plain function and inside `tryPromise`'s thunk:

```vibe es
// compiler-gap: pending VIP-4
function later(): Promise<never> {
  return new Promise(() => { throw new Error("executor") })  // rejects; throws nothing here
}

effect function run() {
  return try Effect.tryPromise(() => new Promise<number>(() => { throw new Error("executor") }))
}
```

```ts effect
import { Effect } from "effect"

function later(): Promise<never> {
  return new Promise(() => { throw new Error("executor") })
}

function run() {
  return Effect.gen(function* () {
    return yield* Effect.tryPromise(() => new Promise<number>(() => { throw new Error("executor") }))
  })
}
```

The options form gives a typed failure instead of `UnknownError`:

```vibe es
// compiler-gap: pending VIP-4
error BadJson { cause: unknown }

effect function parseJson(s: string) {
  return try Effect.try({ try: () => JSON.parse(s), catch: (e) => new BadJson({ cause: e }) })
}
```

```ts effect
import { Data, Effect } from "effect"

class BadJson extends Data.TaggedError("BadJson")<{ readonly cause: unknown }> {}

function parseJson(s: string) {
  return Effect.gen(function* () {
    return yield* Effect.try({ try: () => JSON.parse(s), catch: (e) => new BadJson({ cause: e }) })
  })
}
```

`Schema.decodeUnknownSync(User)` and `Schema.decodeSync(User)` only build decoders and throw nothing; calling either decoder throws `SchemaError` on invalid input.

Reachability quantifies over the selected signature's receiver and parameter types; a safe literal or local range check does not change that signature's thrown type. Thus `toFixed(2)` and `repeat(81)` retain `RangeError` and use `Effect.try`, while `padStart` and `padEnd` have own thrown type `never`: their `ToLength` conversion clamps nonpositive counts, with resource limits still implicit.

Every remaining global and effect 4.1.0 non-Effect export is annotated by a generator, not by hand: `@throws {never}` only when its source has no `throw` reachable from well-typed input, a named class when one is known (`SchemaError`), otherwise `@throws {unknown}`. The normative [`throws.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/throws.json) is generated by `node docs/tools/throws-inventory.mjs --write`. It records the bundled TypeScript lib version and every input file's hash, the exact Effect package version and hashes of its declarations and shipped `dist` sources. Every entry is keyed by `module`, `declaration`, `kind` and `signature`, with `ownThrows`, `rethrows`, `callbacks` and `returns` contracts; non-callable values have `ownThrows: null`. Native argument-validation contracts follow [Implicit and tracked built-in throws](003-failures.md#implicit-throws) (detail 81); source analysis follows imported helpers and constructors, separates returned function bodies and treats incomplete proofs as `unknown`. Function-type callbacks admit `never` by default, while the explicit wrapper thunks, Promise executor and rethrowing parameters carry their admitted thrown type. Native proofs use finite sets of known methods; unmodeled APIs remain `unknown`. Iterable protocol hooks are implicit for `Array.from(it)`, `new Map(it)` and `new Set(it)` (detail 202). Numeric `dual` arities distinguish a data-last factory, whose own thrown type is `never`, from a full invocation of its body; the returned callable keeps that body's contract. Dynamic arity predicates need a separate proof and stay conservative. Detail 202 separately settles `Effect.catchTag`'s data-last factory as `never`; its shipped selector only tests `isEffect`. The JavaScript `dist` files erase parameter types, so scalar-call proofs require known safe arguments or an intrinsic that accepts every value. Unresolved iterator protocols, disposal, tagged-template calls and computed method keys remain `unknown` rather than a guessed `never`. A TypeScript or Effect bump regenerates this artifact; `node --test docs/tools/throws-inventory.test.mjs` rejects stale output. Written contracts still take precedence over shipped annotations, then inference or defaults, as the three-step procedure requires. `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload, so a returned function's contract sits on its own signature:

```ts
import type { Schema } from "effect"

export declare function decodeUnknownSync<T>(s: Schema.Decoder<T>): {
  /** @throws {Schema.SchemaError} */ (input: unknown): T
}
```

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 19

`new f()` on a `.vibe` function gets TypeScript's own error only (delete EK1020's stricter check).

### Detail 22

Recursive inference reports only TypeScript's own errors (TS7022/7023/7024). Delete EK2102's old partial-slot rules.

### Detail 35

(NW 38; VIP-12) A line break after a comma between providers is a syntax error, as VIP-12 says ("its providers and block must be on one line"). Breaks inside a provider are free. The formatter (VIP-34) never breaks a `provide` list at a comma; a long list stays on one line or the author writes `Layer.mergeAll(…)`.
    **Separator scope clarification (detail237).** The existing one-line separator restriction applies immediately before as well as after each top-level provider comma, as Appendix A already states. Both invalid forms use `EK1202` through237's bounded head recovery; expression-internal line breaks remain free.
    ```vibe
    provide AppLive, Users = testUsers { try a() }   // ok
    provide Layer.mergeAll(
      AppLive,
      UsersLive) { try a() }                          // ok
    provide AppLive,
      Users = testUsers { try a() }                   // syntax error
    ```
    Effect TS: `Effect.provide(gen, [AppLive, Layer.succeed(Users, testUsers)])`. Decided by the agent from VIP-12's text and principle 8 (relaxing to Opus's reading (b) later breaks no code); 2026-10-29.

### Detail 40

(NW 5; decided details 2 and 37) The remaining annotations of `lib.d.ts` globals and effect 4.1.0's non-Effect exports are generated, not chosen one by one. Rule: an export is `@throws {never}` only when its 4.1.0 source has no `throw` reachable from well-typed input; a known thrown class is named (`SchemaError`); otherwise `unknown`. The next spec round publishes the generated table in Appendix E with the generator's command.
    **Immutable-main source scope (f6fe7a, 40).** The expanded generated artifact now includes Effect/global owncontracts and nested callable metadata, with conservativeunknowns retained. Selected records were inspected, not every proof or actual annotation consumer. `root-mainf6-source-receipt.json` and `root-mainf6-throws-audit.json` preserve reviewed-prose/structured-artifact limits; no full raw9.19MB human-read or owncompiler/Go/generator/test/gate claim.
    ```vibe
    Option.some(1)                  // never
    Schema.decodeUnknownSync(S)(u)  // SchemaError
    ```
    Effect TS: the tracked ones need `Effect.try`. Decided by the agent from Will 15:57 ("I don't have every api memorized that's on the agent") and principle 8; 2026-10-29.

### Detail 60

(NW 22; VIP-34) Each VIP's rules take one fresh hundred-block of codes, recorded in Appendix B; an old code is kept only where its rule is identical (EK4701). The next spec round assigns every "code pending" row.
    ```vibe
    // VIP-19 rules: EK19xx, e.g. EK1901 "for concurrent operand is a Stream"
    ```
    Effect TS: none. Decided by the agent from Will 15:57 (code numbering is the agent's job) and principle 4; 2026-10-29.

### Detail 64

(Note on decided detail 4) Correction: the `Promise` executor does not rethrow. `new Promise(() => { throw e })` rejects; it never throws at the construction site (JavaScript; opus probe3, all four reviewers). `new Promise(exec)` is not throw-tracked; the executor's body is plain code whose throws become the rejection.
    ```vibe
    const p = new Promise((res) => { res(JSON.parse(s)) })   // no tracked throw: rejection on bad JSON
    ```
    Effect TS: `Effect.tryPromise(() => new Promise(…))` turns the rejection into a typed failure. Decided by the agent from principle 2 (mirror JavaScript); it removes only a false error, so no existing code breaks; 2026-10-29.

### Detail 69

**`import(expr)` with a computed specifier is not checked** (audit 005 D1, with NW 43). `EK4402` checks string-literal specifiers only (`import("node:fs")` is checked); `import(name)` and `import("node:" + m)` compile, as a statically unknown `globalThis[k]` does. One rule covers both dynamic forms: checks apply to statically named references only. Decided by the agent from principle 1 (ordinary lazy loading keeps working) and consistency with NW 43, 2026-10-30.

### Detail 71

**Warnings never change the exit status** (audit 007 M4). `vibelang` and `vibelang lint` exit non-zero only on errors, as `tsc` and ESLint do by default; a repository that wants a warning to fail CI sets its code to `"error"` in `vibe.severities`. Decided by the agent from principle 2, 2026-10-30.

### Detail 74

**Amendment to detail 69: dynamic `import()`** (NW 43). Replace detail 69's sentence "One rule covers both dynamic forms: checks apply to statically named references only." with: "`import(expr)` with a computed specifier stays unchecked: it loads a module and cannot reach `eval` or `Function`. `globalThis` is not treated the same way; detail 73 rejects every use of it except a statically named, non-banned member." A string-literal `data:` or `blob:` specifier, in `import(…)` or an `import` declaration, is `EK0107`: it runs a string as code, as `eval` does.
    ```vibe
    const m = import(name)                              // ok, unchecked
    import("node:fs")                                   // EK4402 (literal, checked)
    import("data:text/javascript,export default 1")     // EK0107
    ```
    Effect TS: `Effect.promise(() => import(name))`. Decided by the agent from 30a (no code from strings) and principle 1 (ordinary lazy loading keeps working); 2026-10-29.

### Detail 75

**`Function` reached through `.constructor`** (closes the alias hole detail 33 targets; Opus M2, r11-001). Reading a property named `constructor` from a value whose static type is a function type or `Function` (including `Function.prototype`, which TypeScript types as `Function`) is `EK0107`. This catches `(async () => {}).constructor`, the usual way to reach the `AsyncFunction` constructor. `constructor` on other objects (`new (obj.constructor)()`) is unaffected. Values typed `any` are not tracked: the ban guards against writing code from strings; it is not a sandbox.
    ```vibe
    const AF = (async () => {}).constructor          // EK0107
    Function.prototype.constructor("return 1")       // EK0107
    const copy = new (point.constructor as any)()    // ok: point is not a function
    ```
    Effect TS: none. Decided by the agent from 30a, detail 33's purpose and principle 8; 2026-10-29.

### Detail 77

**Imported Effect lint rules print `EK38xx` codes and merge configuration like tsconfig** (NW 41; r16-000, r16-007; VIP-38, details 57 and 60). Each `effecttsgo/*` rule VIP-38 imports gets one stable `EK38xx` code, in a table in Appendix B generated from the pinned effect-tsgo version (a VIP-32 bump regenerates it; a rule's code never changes once assigned). The CLI and language server print that code, with the rule name in the message (`EK3801 floatingEffect: …`). Severity resolves in this order, more specific wins, as a tsconfig child overrides its base: an entry for the code in `vibe.severities`; else the repository's Effect language-service configuration (VIP-38: it "selects and configures them"); else the rule's default. Every `EK38xx` code is a lint code and may be set to any value, `"off"` included, whatever severity it prints at: VIP-34's "errors can't be off" covers VibeLang's own rules. The floating-`effect { }` statement (002, 007) is reported by the imported `floatingEffect` rule under its `EK38xx` code.
    **Immutable-main source portion (fb3e96, 77).** 007/publicVIP38 explicitly include selected .ts and .vibe inputs with pinned upstream rule/file eligibility and declaration/library exclusions, retaining Vibe-specific checks only for .vibe. No CLI/LS invocation verified. Complete10-file,47,460-character diff independently read. Source publication only; no own compiler/native/Go/gate check. `main-fb3-source-receipt.json` records exact limits.
    **Immutable-main source scope (ff2544, 77).** The pinned 130-rule inventory and identical007/AppendixB tables now publish code/name/defaultseverity, with existing severity precedence and off allowed for all importedrules. Source metadata publication does not verify actualCLI/LS output or separately publish the new mixed-project applicability clarification. `main-ff2-source-receipt.json` records exact read/consistency limits; no own compiler/gate/native rerun.
    ```json
    { "vibe": { "severities": { "EK3801": "warning" } } }
    ```
    Effect TS: the same rules under the same Effect language-service configuration. Decided by the agent from detail 60 (VIP-38's block is `EK38xx`), detail 57 (`vibe.severities` is keyed by the printed code: one key space, principle 4) and principle 2 (tsconfig precedence); Fable's alternative (rule names as codes) would add a second key space; 2026-10-29.


    **Mixed-project input coverage clarification (VIP-38).** Keep the pinned upstream Effect rule applicability for native `.ts` inputs selected by the project's existing compiler/language-service configuration, and add `.vibe` coverage through the approved integration. VIP-38's statement that the rules run “on `.vibe` files” is an inclusion promise, not an instruction to suppress existing upstream diagnostics in TypeScript inputs. The existing user guide already explicitly says both file kinds. Preserve upstream/configured file eligibility, declarations/library exclusions and rule-specific applicability; this is not a promise to lint every dependency or a new global file-scope option.
    VibeLang's own source-syntax/semantic checks remain distinct from imported Effect lint: this does not require `.ts` to adopt VibeLang syntax, globals or native-exception changes. The imported rules retain77's configured severity/identity contract and98's upstream pin across CLI, language server and `vibelang lint`; other lint tools keep their own configuration. Any discrepancy in exact emitted codes or runner behavior remains a separately evidenced implementation/table issue, not approval to invent an alternate per-extension lint protocol.
    ```vibe
    effect function example() {
      succeed(1) // the selected imported floatingEffect rule still applies
    }
    ```
    Effect TS: `import { Effect } from "effect"; const example = Effect.gen(function* () { Effect.succeed(1) })` remains eligible for that upstream rule when written in a selected native `.ts` file. This records rule coverage, not a new runtime transformation or a claim that a particular compiler diagnostic probe was run.
    Decided by the agent from accepted VIP-38's built-in Effect runner and existing-configuration promise, principle1 (idiomatic Effect TypeScript keeps its existing lint), principle4 (one upstream integration) and principle8 (retain the current selected checks rather than create an unapproved exclusion), 2026-10-30. Clarify public VIP-38/007 and reconcile the already-both-files user guide under213. The migration report's parked scope question needs no further Will choice; exact source/runner conformance remains separately verified.
    **Native-input source clarification:** applied in 01956dd360b5a19bcf0ff3e43135f62d0862be8e (spec-fix-d, queued; not main). Four bounded007/publicVIP38/CLI/devtools clauses explicitly retain selected .ts and .vibe imported-rule coverage with pinned per-rule/file eligibility, declaration/library exclusions and existing configuration. Native TypeScript language checking and VibeLang-only language checks remain distinct. Four regressions fail immutable actual main8b4abee2 and pass Node/Bun; configured spec, regen/docs/forms pass with no form moves. No compiler port, code-inventory repair or conformance claim.

    **Smithers green9 scope question, decide-live, 2026-11-02:** this is already settled by accepted VIP-38 and this detail. Imported Effect lint runs on selected native `.ts` and `.vibe` inputs with the pinned upstream eligibility and exclusions. The current generated inventory gives `EK3801` (`floatingEffect`), `EK3865` (`missingEffectContext`) and `EK3870` (`missingReturnYieldStar`) default severity `error`. Preserve the precedence `vibe.severities` > existing Effect language-service configuration > pinned default. Every imported code remains configurable, including `off`; that capability does not automatically authorize changing a migration target's checks to pass. Do not make all imported rules warnings or limit them to `.vibe` merely because an older compiler did not report them.

    ```vibe
    effect function example() {
      Effect.succeed(1) // selected imported floatingEffect rule applies
    }
    ```

    Effect TS: `import { Effect } from "effect"; const example = Effect.gen(function* () { Effect.succeed(1) })` in an eligible `.ts` file is checked by the same selected pinned rule and effective configuration. This is an applicability example, not a new compiler execution receipt.

    Setup may preserve/translate an existing approved lint configuration through the existing modern root `vibe.severities` contract; it must not silently invent severity downgrades, suppressions or extension exclusions. Compare native and converted source on the same actual SDK and effective configuration before classifying a conversion regression. The reported older `0.0.8` versus `0.0.11` diagnostic-count difference is an upgrade/configuration observation, not by itself a conversion defect. Capture the actual command status separately under292; a printed `error` category alone does not prove a particular process exit. Genuine generated-name TypeScript errors remain separately investigated. This reuses77/98/272/291/292 and principles1/2/4/8; no new rule number or Will question. Immutable current VIP-38 and the three inventory rows were read; no CLI, LSP, compiler or target test was run by this lane.

    **Native TypeScript activation, Smithers owner ruling recorded 2026-11-02T19:15Z:** “selected” includes the upstream/configured activation condition; including a `.ts` file in a compiler project does not itself enable the Effect language-service plugin. Check the effective configuration of every project used by the check scripts, including inherited configuration. If that configuration does not enable the Effect plugin, imported Effect lints must not fire on its native `.ts` files. If enabled, retain its rule/file selection and configured severities, followed by the pinned per-rule defaults. The three `error` inventory defaults quoted above apply after activation; they are not a new automatic opt-in for all native TypeScript. Do not add suppressions to Smithers to conceal diagnostics that violate this activation contract.

    This clarifies77's upstream/configured eligibility and existing-configuration promise; it does not exclude all `.ts` files, globally demote rules, disable ordinary TypeScript diagnostics, or change approved `.vibe` integration. The Effect TS counterpart is the same native source under the same upstream plugin activation and effective project configuration. A minimal native `.ts` floating-Effect fixture with the plugin absent should receive no imported Effect lint; the enabled-plugin twin uses its actual configured/default severity. Those are prescribed owner regressions, not tests executed here. Recorded by the agent from the project owner's ruling, principle2 (mirror the actual native TypeScript/tool configuration) and principle8 (no new unselected checks), 2026-11-02. No fresh Will answer or new number. This makes the activation condition explicit in the earlier green9 answer; actual runner/code/status conformance still needs matching receipts.

### Detail 80

**`A!E` may be a function or constructor type's return without parentheses** (NW 44; Opus M3, Fable M1; r16-001; amends detail 47). `(id: string) => User!NotFound` is `(id: string) => (User!NotFound)`, as `() => A | B` is `() => (A | B)` in TypeScript; the same for `new (…) => A!E`. Detail 47's other rules stay: `!` still does not mix with `|` or `&` without parentheses, and a conditional type's check, extends, true and false parts still need them.
    ```vibe
    type Find = (id: string) => User!NotFound      // ok: Effect.Effect<User, NotFound>
    type Make = new () => Conn!DbError             // ok
    type G = () => A!E | B                         // syntax error (detail 47: mixes ! and |)
    type C = T extends U ? A!E : B                 // syntax error: write (A!E)
    ```
    Effect TS: `type Find = (id: string) => Effect.Effect<User, NotFound>`. Decided by the agent from principle 2 (TypeScript's function-type return is a full `Type`), principle 1 (the most common Effect signature needs no parentheses) and principle 8's converse (relaxing an error breaks no code; Appendix A's grammar has one parse); 2026-10-29.

### Detail 83

**Generic-`data` helper name in `.d.vibe.ts`** (NW 49; Opus m8; r16-001; refines detail 26). The helper for `data Outcome<A>` is named `$Outcome$Definition`. If the module already declares that name, the compiler appends `$2`, `$3`, … and takes the first free name, as `tsc` picks the first free name for its own emitted helpers. The name is therefore the same on every build of the same source and still never collides with a user name.
    ```ts
    // outcome.d.vibe.ts
    declare interface $Outcome$Definition extends Data.TaggedEnum.WithGenerics<1> { … }
    ```
    Effect TS: a `WithGenerics<1>` interface under any name. Decided by the agent from principle 2 (deterministic emit, as `tsc`'s) and detail 26 (hygienic); 2026-10-29.

### Detail 85

**Generator and `async` catch handlers are syntax errors** (NW 51; Fable m3; r16-002; amends 31a and VIP-5). A `catch` handler is an arrow function, a function expression or an `effect` form; `async` arrows, `async` function expressions, generator expressions and async generator expressions are a syntax error with the quick fix "remove `async`" or "remove `*`". Appendix A's handler productions drop those four alternatives. `EK0507` then covers only a plain handler whose body returns a Promise (`x catch (e) => queryDb(e)`).
    ```vibe
    x catch (e) => 7                 // ok: fallback value
    x catch async (e) => 7           // syntax error: remove async
    x catch function* (e) { }        // syntax error: remove *
    x catch effect (e) => try g(e)   // ok
    ```
    Effect TS: `Effect.catch(x, () => Effect.succeed(7))`. Decided by the agent from principle 7 (no idiomatic Effect handler is a Promise or a Generator), principle 3 (syntax still decides) and principle 8; the async form was already always an error, so no accepted program changes; 2026-10-29.

### Detail 87

**Primitive built-in class patterns** (extends detail 67a; D208's primitive row; TC39 snapshot `String[Symbol.customMatcher]` and its siblings). `String`, `Number`, `Boolean`, `BigInt` and `Symbol` patterns test the primitive or its boxed object, as the snapshot does: `typeof s === "string" || s instanceof String`, and so on. The extracted list is `[s]` for a primitive and `[s.valueOf()]` for a boxed object. The boxed test uses `instanceof`, so detail 67a's cross-realm divergence applies to boxed objects only.
    ```vibe
    match (v) { when String(let t): t.length; when Number: 0; default: -1; }
    ```
    Effect TS: `if (typeof v === "string" || v instanceof String) { const t = typeof v === "string" ? v : v.valueOf(); return t.length }`. Decided by the agent from principle 2 (the pinned TC39 snapshot) and detail 67a's implementability rule; 2026-10-29.

## Items 88–93 (lane decide-r17, 2026-10-29: Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later")

Each item closes a round-17 NEEDS-WILL entry (`v16/NEEDS-WILL.md`, "NW n"), a chapter lane's note (`v16/needs-will-r17-*.md`) or a gap found while deciding them. Principles are numbered as in items 33–66. Will can override any item in `will-overrides.md`. None is class B: no item changes what a compiling `.vibe` program does at run time, and each new error falls only on code the spec marked Undecided, which is not part of the language until decided (chapter 000).

### Detail 89

**One test for "is an Effect" and "is a Promise" in the four result diagnostics** (NW 53; Opus r16 M1; r17-003; replaces the integrator's every-member rule in 002 "Result tests"). `EK0103`, `EK0508`, `EK0404` and `EK0507` all ask the same question: may this value be an unrun Effect (or an unrun Promise)? A type answers yes when it is not `never`, `any` or `unknown` and **at least one** union member is an Effect (for `EK0103`, `EK0508`) or `PromiseLike` (for `EK0404`, `EK0507`). Detail 36 keeps its every-member test, because it asks the opposite question (may this call be exempt from throw tracking?), whose conservative answer is no. `try` (`EK0502`), `catch` (`EK0506`), `try.all` (`EK1801`) and detail 88 keep assignability.
    ```vibe
    effect function f() {
      const p = maybeQuery()                      // maybeQuery(): Promise<number> | undefined: EK0404
      const q = try tryPromise(async () => maybeQuery())   // ok
    }
    async function g(e: Effect.Effect<number> | undefined) {
      return await e                              // EK0103: e may be an Effect
    }
    x catch (e) => (cond ? fetchUser("g") : null) // EK0508 warning: the fallback may be an unrun Effect
    ```
    Effect TS: `Effect.tryPromise(async () => maybeQuery())`. Decided by the agent from principle 8 (an error can be relaxed later), principle 4 (one test for four rules instead of two opposite ones) and principle 2 (typescript-eslint's `no-floating-promises` treats a union with any thenable member as a Promise); the four reviewers and the integrator recommend it for Promises; 2026-10-29.

### Detail 96

**`@throws` or `@rethrows` on an effectful `.vibe` callable is `EK0406`** (NW 59; audit 003 interactions m1; r18-003; VIP-4 amendment; next free code in VIP-4's block, detail 60). An effectful callable can't throw (principle 6; detail 1), so a written tag can never apply. In a `.vibe` file a `@throws` or `@rethrows` JSDoc tag on an effectful callable (an `effect` function, arrow, method or producer, or any callable whose return type is wholly `Effect`, `Stream` or `Layer`, detail 36) is `EK0406` ("an effectful function can't throw: declare its failure in the Effect's error type"), with the quick fix "remove the tag". In `.ts`, `.d.ts` and JavaScript inputs, which VibeLang doesn't compile, such a tag is ignored (detail 37).
    ```vibe
    /** @throws {NotFound} */
    effect function find(id: string) { return yield* Effect.fail(new NotFound()) }   // EK0406
    effect function find2(id: string): User!NotFound { return yield* Effect.fail(new NotFound()) }   // ok
    ```
    Effect TS: the failure lives in the type, `Effect.Effect<User, NotFound>`. Decided by the agent from principle 6 and principle 8 (an error can be relaxed to "ignored" later; the reverse breaks code); 2026-10-29. Apply to 003 at the marker and to Appendix B.

### Detail 97

**The `Function` member-access exemption covers `.prototype` only** (NW 60; Fable r17 m4; r18-001; amends detail 33, keeping its `instanceof` exemption). Detail 33's purpose is "no functions built from strings", and `Function.call(null, "return 7")`, `Function.apply(null, [s])` and `Function.bind(null, s)` all build one. So the object-of-a-member-access exemption narrows to a statically named `prototype`: `Function.prototype`, `Function?.prototype`, `Function["prototype"]`, and the same through `globalThis.Function` (detail 73). Every other member of the global `Function` is `EK0107`. `Function.prototype.constructor` stays `EK0107` (detail 75).
    Public VIP33 reconciliation landed as c080051ae52b from439c77582723 (spec-fix-c; globalThis platform code and VIP1 Function exemptions only).
    **Immutable-main source receipt (54182a, 97).** Immutable main `54182a644026` reconciles public VIP33 platform EK4402 versus legacy EK0107 and explicitly retains the existing qualified Function instanceof/prototype exemptions (history `5e0a70f5333a`). Source publication only, without extending the exemptions or asserting compiler parity.
    ```vibe
    x instanceof Function                 // ok (detail 33)
    Function.prototype.toString.call(f)   // ok
    Function.call(null, "return 7")()     // EK0107
    Function.name                         // EK0107
    ```
    Effect TS: none; `typeof x === "function"` is ordinary TypeScript. Decided by the agent from 30a's intent, detail 33's stated purpose and principle 8 (relaxing to another member later breaks no code); 2026-10-29. Apply to 001's `Function` row and Legacy JavaScript list.

### Detail 98

**The imported lint rules are pinned to `@effect/tsgo@0.57.0`** (NW 61; Sol r17 m2, Astra r17 m1; r18-007; completes detail 77). The two options in NW 61 are one fact: the repository vendors a named upstream release. `typescript/tsc/internal/effecttsgo/UPSTREAM` records `repository: https://github.com/Effect-TS/tsgo`, `tag: @effect/tsgo@0.57.0`, `commit: 999942fa41462eb46dfcb2d718e7671db8e14156`, and `sync.sh <tag>` is the only update path. That file is the normative pin, as `package.json` pins `effect` exactly (detail 70). Chapter 007 names the tag and commit and links `UPSTREAM`; Appendix B's generated rule/code/default-severity table names the same tag in its header; a VIP-32 bump runs `sync.sh` and regenerates the table, keeping every assigned code (detail 77). Separately, the implementation prints `EK4801` for `floatingEffect` and other `EK48xx` codes; details 60 and 77 assign VIP-38's block `EK38xx`, so that is a compiler bug for a fix lane, not a spec question. The spec keeps `EK3801`.
    **Immutable-main source scope (ff2544, 98).** The artifact and publictable headers retain @effect/tsgo@0.57.0/revision999942fa41462eb46dfcb2d718e7671db8e14156. All124 declaredinput SHA256digests match immutableff2544source. This is pin/input consistency, not upstreambehavior/generatorexecution or actualcode-emission conformance. `main-ff2-source-receipt.json` records exact read/consistency limits; no own compiler/gate/native rerun.
    ```text
    typescript/tsc/internal/effecttsgo/UPSTREAM   tag: @effect/tsgo@0.57.0   commit: 999942fa4146
    ```
    Effect TS: the same rules from `@effect/tsgo@0.57.0`. Decided by the agent from the repository's `UPSTREAM` file, principle 2 (a dependency pinned by released version, as npm and detail 70 do) and VIP-32; 2026-10-29. Apply to 007 at the marker and Appendix B.

### Detail 100

**An extractor on an ordinary class without its own matcher is `EK0704`** (NW 63; Opus r18 M2; r19-004, r19-008; VIP-7 amendment, extends details 67, 93 and 94; next free code in VIP-7's block, detail 60). When a class pattern's callee takes detail 94's construct-signature path (no own `Symbol.customMatcher`, not a retained fixed pattern, built-in or VibeLang declaration), the draft's fallback `Function.prototype[Symbol.customMatcher]` returns `true` for an instance, and `InvokeCustomMatcher` throws `TypeError` because `true` is not an object. So the extractor form `when C(…)`, with any argument count, `()` included, can only fail to match or throw. It is `EK0704` ("`C` has no matcher, so `C(…)` can't extract: test the class with `when C:` and destructure with `and { … }`"). Quick fixes: `when C:`; and, when the pattern's arguments are bindings and `C`'s constructor declares that many parameter properties, `when C and { p1: let a, p2: let b }:` using their names. An inherited matcher doesn't count (detail 93), so `class B extends A {}` with `A`'s static matcher also gets `EK0704` for `when B(…)`. The bare `when C:` is unchanged (`s instanceof C`, no bindings). The runtime rule stays the draft's; an extractor reached in a `.ts` file or through `any` still throws.
    ```vibe
    class Point { constructor(readonly x: number, readonly y: number) { } }
    match (p) { when Point(let x, let y): x + y; default: 0; }   // EK0704: write when Point and { x: let x, y: let y }:
    match (p) { when Point and { x: let x, y: let y }: x + y; default: 0; }   // ok
    match (p) { when Point: 1; default: 0; }                      // ok: p instanceof Point
    ```
    Effect TS: `p instanceof Point ? p.x + p.y : 0`. Decided by the agent from principle 8 (a guaranteed run-time `TypeError` becomes a compile error, which can be relaxed later) and principle 4 (no binding type has to be invented for an arm that can't bind); the integrator, Opus r18 and both chapter lanes recommend it; every `match` is `compiler-gap: pending VIP-7`, so no compiled program changes; 2026-10-29. Apply to 004's typing table row and "Class patterns" marker, 008's "Callable patterns" marker, Appendix B (`EK0704`, VIP 7) and VIP-7's amendment list.

### Detail 101

**`EK4402`'s banned platform globals are derived, not enumerated** (NW 64; Fable r18 design cost 1; r19-005; amends detail 56 under VIP-33, keeping its quick fixes and detail 73's and 90's access rules). Will's rule is "All web apis and all node.js apis should be wrapped and effectful"; detail 56's list was one reading of it, and every name it missed (`history`, `requestAnimationFrame`, `FileReader`, `WebAssembly`, …) is an unseen platform dependency. The rule, by resolved binding (principle 3), not by spelling:
    **Immutable-main source portion (098e7a, 101).** The join-name import example now uses an ordinary alias from relative `./strings.vibe`, replacing a banned Node value import without changing identifier reservation. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
   - A value reference in `.vibe` code is `EK4402` when the symbol it resolves to has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, no declaration in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist. A local binding, an import, or an Effect module VIP-14 puts in scope (`Option`, `FileSystem`, `Cache`, `Headers`, `Worker`, detail 76) shadows the global first, so it is never reached. Type positions stay TypeScript's.
   - The allowlist is closed: detail 56's pure data utilities (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa`, `AbortController`; `Intl` is already an ECMAScript-library global (ECMA-402)) plus `AbortSignal`, which Effect passes to every `Effect.tryPromise` callback. `AbortSignal.timeout` starts a timer and stays `EK4402`, as `setTimeout` does. Adding a name later is a relaxation (principle 8); removing one would break code.
   - The set is generated, like detail 40's annotations and detail 81a's inventory, from the pinned TypeScript libs and `@types/node` into `docs/design/inventory/platform-globals.json`; Appendix B and 005 link it instead of listing names. A TypeScript or `@types/node` bump regenerates it. The compiler checks the declaration sources directly, so the file documents the rule rather than feeding it.
   Unshadowed window names such as `name`, `status`, `length`, `top`, `open` and `close` are on the derived list: a stray `name` that silently reads `window.name` becomes an error. Measured on `main` (`~/vibe/fix/alpha/decide-r19-scratch/globals.py`, 678 `.vibe` files, 925 names beyond detail 56): every word match is a local binding, a property key, an Effect module or a type position, except `x instanceof AbortSignal` in the two `hatches-*` cases, which the allowlist keeps compiling.
    ```vibe
    history.pushState({}, "", "/x")       // EK4402: move to a .ts file or wrap it in a service
    requestAnimationFrame(draw)           // EK4402
    const r = new FileReader()            // EK4402: use FileSystem
    signal instanceof AbortSignal         // ok: allowlisted
    const name = "Ada"; name.length       // ok: the local shadows window.name
    ```
    Effect TS: `FileSystem.FileSystem` for file reads, `Effect.sleep` for timers, a user `Context.Service` around browser APIs; `Effect.tryPromise((signal) => fetchThing(signal))` for the signal. Decided by the agent from Will's VIP-33 words (the same source as detail 56), principle 3 (resolve the binding, as detail 76 does for `Worker`) and principle 8 (an unlisted name defaults to banned; the allowlist can only grow); 2026-10-29. Apply to 005's marker and "The platform standard library" list, Appendix B's `EK4402` row and VIP-33's amendment list.

### Detail 106

**The initial imported-lint allocation is alphabetical after the retained first code.** (r20-007/r20-900; Sol round-19 M3; Astra m2; completes details 77/98.) Keep `EK3801 floatingEffect`. For the pinned `@effect/tsgo@0.57.0` registry, sort all other rule `Name` strings in ascending ASCII order and assign ordinal 2 onward; the first are `abortControllerInEffect` and `acquireReleaseDisposable`. Order by the emitted name, not by Go variable name, category, file path, or registration order. Persist the name/ordinal/code mapping. Later upstream bumps preserve every assigned code, leave removed-rule slots retired, and append new names in sorted order after the highest ordinal. The overflow spelling is the separate default immediately below; this allocation order does not depend on it.
    **Imported-code fuzz oracle source receipt (db82, 106).** At immutable `db82b69ac4aa`, the fuzz facts helper reads the published `lint-codes.json` mapping, and its test compares the compiler's actual registry/count against that independent artifact. It no longer builds its expected names from the compiler itself or stale Appendix wording. The complete selected two-file,4,778-character Go diff was read. This is source-reader/oracle evidence, not an own Go run, full CLI/LS diagnostic or severity proof; unchanged spec/artifact receipts retain their original revision scope. `main-db8-selected-readers-receipt.json` records limits.
    **Immutable-main source scope (ff2544, 106).** All130 persisted ledger assignments matchtheinventory: floatingEffect staysEK3801 andtheotherinitialnames takeASCII-ordered ordinals2–130. Publicsource states futureappend-only reservations; futurebumps/deletions werenotexecuted here. `main-ff2-source-receipt.json` records exact read/consistency limits; no own compiler/gate/native rerun.
    ```vibe
    effect { succeed(1) } // EK3801 floatingEffect, never reassigned to another rule
    ```
    Effect TS: `Effect.gen(function* () { return 1 })` discarded as a statement, reported by the same pinned `floatingEffect` rule. Decided by the agent from principle 4 (one reproducible ordering without a hand-maintained category policy), details 77/98 (stable codes), and both chapter lanes' alphabetical recommendation, 2026-10-29. The generator owned by `spec-artifacts` must retain `EK3801`; this decision authorizes no edit to that lane's unlanded workspace.

### Detail 122

**Data variants cannot be named $is or $match, Effect's own helper properties.** (live `900-data-helper-variants`; VIP-16/VIP-28; `EK1602`, corrected by detail 130.) Diagnose either name on a `data` variant, generic data included, and offer a rename of the declaration and its resolved references (for example `Is` or `Match`, choosing a fresh name). Leave the grammar broad enough to issue this semantic diagnostic. Other variant names retain the exact `Data.TaggedEnum`/`Data.taggedEnum` counterpart and their existing nonthrowing constructor contract. Do not replace the runtime proxy or claim its two reserved helper properties construct variants.
    **Immutable-main source scope (f6fe7a, 122).** 006/AppendixB/publicVIP16 now reserve$is/$match for nongeneric/generic data under1602. The006 summary row is detached after a TSfence and has a separate formattingfollowup under the activeCsourceclaim. `root-mainf6-source-receipt.json` and `root-mainf6-throws-audit.json` preserve reviewed-prose/structured-artifact limits; no full raw9.19MB human-read or owncompiler/Go/generator/test/gate claim.
    Current replacement: applied in 19fd0465084af57fee4f75742cfdd19e5fd8c106 (spec-fix-c; supersedes 83f85800f5ad after main rebase and current-release placement; queued, not a main receipt).
    Status: applied in 83f85800f5adeb1558eb4e9cf01dbe365be302be (spec-fix-c; queued, not yet a main receipt).
    ```vibe
    data D { $is; $match; Normal } // EK1602 on $is and $match
    data D2 { Is; Match; Normal }  // constructors preserve the promised variant behavior
    ```
    Effect TS: `type D2 = Data.TaggedEnum<{ Is: {}; Match: {}; Normal: {} }>; const D2 = Data.taggedEnum<D2>()`. `Data.taggedEnum` always interprets `$is`/`$match` as helpers; a typed zero-argument call can return a predicate or throw instead of constructing a variant. Decided by the agent from principle 8 (reject the unusable constructor names; this can be relaxed later), principle 7 (keep Effect's actual taggedEnum behavior), and VIP-16's exact counterpart, 2026-10-29. The main corpus search found no variant declaration using either name; this is a VIP-16 amendment, not a silent runtime shim.
    **Independent f6fe7 source portion (122).** Chapter006/publicVIP16 and the catalog now reserve$is/$match for all data declarations, including generic data, withEK1602 and rename-resolved-reference advice. Full27,227-character nongenerateddiffread; sourceonly, no decide-livecompiler/gaterun. `main-f6f-source-receipt.json` records limits.

### Detail 124

**Inventory surviving TypeScript-form advisories separately from imported lint, retaining unchanged codes.** (live `900-ts-lint-codes`; VIP-34/VIP-38, details 60/71/77/98/106.) The compiler's legacy `EK48xx` declarations are inputs to the audit, not proof that every old rule is part of the new language. Compare each registry trigger and fix against accepted VIPs and current source behavior. Imported upstream rules (including legacy `EK4801 floatingEffect`) use their single generated `EK38…` identity and pinned default, never a duplicate own diagnostic; keep detail 77's severity precedence. For VibeLang-specific TypeScript-form advisories still valid under a VIP, retain an existing `EK48xx` code only when its rule is identical, per detail 60's exception, and publish each trigger, default warning, and mechanical fix in chapter 007/Appendix B. They are configurable warnings in `vibe.severities`, and warning-only runs exit zero (detail 71).
    **Immutable-main source scope (ff2544, 124).** 007 EK4833 advice now excludesaninterfaceextends element where A!E!R cannotspellthatnativeheritage. This is a safe-advice source qualification, not a new diagnosticcode, languageban or owncompiler test. `main-ff2-source-receipt.json` records exact read/consistency limits; no own compiler/gate/native rerun.
    **Immutable-main source receipt (695576, 124).** Verified at immutable main `695576acb44b`: 007/AppendixB publish the eleven surviving TypeScript-form advisory codes/triggers and context-safe optional repairs, separately from the still-unpublished imported Effect table. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 7ef1f862f901 (spec-fix-a; queued, not yet a main landing receipt). Surviving own form advisories only; imported lint artifacts remain with spec-artifacts.
    ```vibe
    class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}
    // surviving advisory: use error NotFound { id: string }, retaining an identical old code
    // no advisory may suggest denied inline modules, hidden execution, or an automatic main runner
    ```
    Effect TS: the same class is legal; the warning recommends VIP-13 sugar without changing its runtime meaning. Retire unsupported advice rather than documenting it as a requirement: e.g. `EK4840`'s Option method syntax has no accepted VIP, `EK4843`'s automatically-started main contradicts VIP-26, and a schema-error rewrite must use VIP-29 `schema error`, preserving validation instead of dropping it. Existing non-lint compiler errors stay errors; this inventory does not downgrade them. Decided by the agent from principle 3 (one rule identity, by resolved symbol), principle 4 (one table shared by CLI/LSP/config), VIP-34's migration-tool requirement and detail 60's unchanged-code exception, 2026-10-29. The full per-rule table remains work for the claimed spec fixer; no completion claim or new warning is created merely by this decision.

Landing receipt: source 7ef1f862f901 landed in main 695576acb44b (queue 1793372738-spec-fix-a, gate mq-10302026-7).
    **Public authority and kept codes (Opus r31 M10, Fable r31 M2, Astra r31 m1).** Detail 213 governs the gap all three reviewers name. Publish the eleven surviving advisories (`EK4830`–`EK4837`, `EK4839`, `EK4841`, `EK4842`) in a public VIP-34 amendment that lists each trigger, default warning and context-safe quick fix, and cite it from 007 and Appendix B. Keep the codes under detail 60 unchanged-code exception: do not renumber them into a new block (Fable `EK34xx` proposal). State that kept-code exception in the Appendix B intro beside the `EK38` capacity rule (detail 142) and the migration-warning exception (`EK4853`–`EK4855`, detail 194). Keep `EK4833`: like `EK4830` for `Data.TaggedError`, it suggests the VibeLang spelling of valid Effect TypeScript, and 001 written `Effect.Effect<User, NotFound, Users>` example must mark the warning or use `User!NotFound!Users`. Do not delete the rules or demote them to non-normative text while publication is pending (Astra option): the decision exists, and its public record is delivery work. Decided by the agent from details 60/124/213 and principle 4 (one code identity per unchanged rule), 2026-10-30.
    Status (VIP-34 amendment, 007 citation, Appendix B kept-code exceptions): applied in 48d667e6343c (spec-fix-d; queued, not yet a main landing receipt).
    Status (001 example only): applied in a96957dc3549, landed in main f58798560fe7 (spec-fix-a entry bb50c30ea831). The 001 .vibe examples use A!E!R; 002/003 .vibe witnesses still write Effect.Effect<…> unmarked (live findings, spec-fix-a round-31 batch).

### Detail 131

**The Hack pipe's missing-topic early error checks its AssignmentExpression child.** (live `900-pipe-body-early-error`; VIP-23 pinned snapshot reconciliation.) For `PipeBody : AssignmentExpression`, reject when that AssignmentExpression's `ContainsOuterTopic` is false, not when the wrapping PipeBody's is false. Keep `ContainsOuterTopic(PipeBody) = false` to stop a nested pipeline's topic from satisfying the outer one. The original printed early error otherwise rejects every accepted pipe. Record the erratum in the vendored README, 002 and Appendix A; keep the upstream spec.html unchanged.
    **Immutable-main source receipt (695576, 131).** Verified at immutable main `695576acb44b`: 002/AppendixA and the pipe snapshot README apply the missing-topic check to the AssignmentExpression child while preserving nested topic boundaries. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const a = 1 |> % + 1       // ok: 2
    const b = 1 |> f()         // syntax error: missing topic
    const c = 1 |> (2 |> % + 1) // syntax error: outer pipe has no topic
    ```
    Effect TS: for the admitted example `const a = 1 + 1`, with a hygienic topic temporary for a general left operand. Decided by the agent from VIP-23's accepted topic-bearing examples and nested-call meaning, principle 2 (syntax-directed operation applied to its intended child), and principle 4 (repair the mistaken node rather than special-case all valid pipelines), 2026-10-29. No new topic scope is introduced.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 142

**Imported-lint overflow extends the ordinal; detail 107 is final** (NW 66; r20-007, r20-900; replaces detail 107's "class B default" condition and keeps its rule). Imported rule ordinal *k* prints `EK38` then *k* padded to at least two digits: `EK3801` … `EK3899`, `EK38100` … `EK38130`. Codes match the generated table as whole strings, so `EK3810` and `EK38100` are distinct. No `EK39xx` overflow block is reserved.
    **Imported-code fuzz oracle source receipt (db82, 142).** At immutable `db82b69ac4aa`, the fuzz facts helper reads the published `lint-codes.json` mapping, and its test compares the compiler's actual registry/count against that independent artifact. It no longer builds its expected names from the compiler itself or stale Appendix wording. The complete selected two-file,4,778-character Go diff was read. This is source-reader/oracle evidence, not an own Go run, full CLI/LS diagnostic or severity proof; unchanged spec/artifact receipts retain their original revision scope. `main-db8-selected-readers-receipt.json` records limits.
    **Immutable-main source scope (ff2544, 142).** PublicVIP34/38 and007/900 now state EK38 plus a minimum-two-digit growing decimal suffix, includingEK38100throughEK38130 withoutusingEK39. All130 code strings were checked; Appendix-row-parser source accepts growingEK38 suffixes. This is not fullCLI/extraction/configuration conformance. `main-ff2-source-receipt.json` records exact read/consistency limits; no own compiler/gate/native rerun.
    Earlier tooling receipt: numeric extraction source `255bc6c271af` was queued while citation/catalog consumption awaited the imported-table artifact. That table-presence dependency is now satisfied by immutable main `ff25444dc8a9` and `main-ff2-lint-consistency.json`; this does not certify that separate extraction change or actual CLI/LS code output. Preserve its own queue/test/landing receipt.
    Status (007 config clause): applied in f76a4792a331 (spec-fix-d; queued, not yet a main receipt). The generated table/Appendix B companion remains in spec-artifacts c6443b28c3cb.
    ```vibe
    effect { succeed(1) }            // EK3801 floatingEffect (detail 77), unchanged
    // vibe.severities: { "EK38100": "off" } is valid once ordinal 100 exists; { "EK3901": "off" } is EK3006
    ```
    Effect TS: identical lint behavior under `@effect/tsgo@0.57.0`; only the printed identifier differs. Decided by the agent from detail 60 (`EK39xx` is VIP-39's block, so reserving it for VIP-38 breaks the one-VIP-one-block rule the first time VIP-39 has a rule) and principle 2 (TypeScript widened its codes to five digits, `TS17004`, `TS18046`, instead of fixing a width), 2026-10-30. Will can override in `will-overrides.md`.

    **Historical numeric-reader verification limitation (before ff2544 publication).** For `255bc6c271af`, the fixer reports four baseline groups failing and all five subtests passing after, plus regeneration183/docs9/forms/spec. Its full short-fuzz run still reports `rule:await-effect` XPASS, reproduced on unmodified main; the existing fix-vip-match claim owns that retirement. The numeric extraction receipt is not a whole-suite pass, an imported-table landing, or a new diagnostic-number limit. The later ff2544 receipt above now verifies the actual catalog rows and reader-source updates; no fake row or suppression is approved. These checks remain attributed, not rerun by decide-live.

### Detail 152

**Tagged exhaustiveness requires a present tag and covers each normalized member independently.** (Opus round-20 m1/m2; clarifies details 78/102.) A checked object's _tag property is required/non-optional and its resolved declared type is exactly one string literal; do not strip undefined or ignore an optional-property flag to make it qualify. A required literal tag shared by multiple union members does not merge their required payload keys. An object pattern covers each member with that tag only when every other bare/binding key it tests is required on that particular member; uncovered same-tag members remain uncovered. Keep all other conservative coverage rules.
    ```vibe
    // optional tags do not make an exhaustive checked subject:
    type MaybeA = { _tag?: "A" }
    // for s: { _tag: "A"; x: number } | { _tag: "A"; y: number }
    match (s) { when { _tag: "A", let x }: x; } // EK4701: the y member remains
    ```
    Effect TS: TypeScript's actual property-presence/discriminant narrowing of each union member; absence is not a literal tag value. Decided by the agent from principle 2 (required versus optional TypeScript properties), principle 8 (do not claim proof for an absent tag or an untested payload member), and detail 78's per-member normalization, 2026-10-30.

### Detail 153

**Platform symbol resolution, not the generated name inventory, determines EK4402.** (Opus round-20 m3; restates detail 101.) The platform inventory documents the pinned host declarations; it does not override the compiler's resolved binding rule. If a project's selected libs omit a platform declaration and its free name is unresolved, retain TypeScript's TS2304 rather than invent an EK4402 binding from the inventory. A custom global declaration with no banned declaration source is not automatically a platform global merely because its name matches a listed host name. A resolved symbol merged with a banned host declaration still follows detail 101. Local/import/Effect namespace precedence remains.
    ```vibe
    // with only lib.es* and no custom fetch declaration:
    fetch("/api") // TS2304, not an inventory-created global binding
    ```
    Effect TS: the same TypeScript library selection and symbol resolution; an actual host fetch binding uses an explicit Effect service instead. Decided by the agent from principle 3 (symbols, not spellings) and detail 101's explicit statement that the compiler checks declaration sources and the file merely documents them, 2026-10-30. This resolves the prose reading without adding a new global or a new acceptance rule.
    Status: applied on main a899a2fcb3cc (005 platform rule: a name resolving to nothing is TS2304, not EK4402; verified by spec-fix-c 2026-10-31).

### Detail 154

**The global AbortSignal timeout member is banned through statically resolved reads, including destructuring.** (Opus round-20 m4; makes detail 101's existing exception explicit.) EK4402 applies when a statically named member read or destructuring property resolves to the standard AbortSignal constructor's timeout property, including dot/optional access, a literal-string or no-substitution-template element key, and constructor aliases that preserve that member symbol. A user-defined AbortSignal/member is unaffected. This bans copying the timer-starting method as well as calling it. A key that is not statically known remains unchecked; this is not a runtime sandbox, like the existing any/reflective escape policy.
    ```vibe
    AbortSignal.timeout(100)                    // EK4402
    const { timeout } = AbortSignal             // EK4402
    const AS = AbortSignal; AS["timeout"](100) // EK4402: same resolved member
    ```
    Effect TS: use Effect.timeout/Effect.sleep for the timer behavior; ordinary signal values stay allowlisted for Effect.tryPromise. Decided by the agent from detail 101's explicitly banned timeout operation, principle 3 (the resolved member rather than its spelling), and principle 4 (the same static-reference rule for copying and calling), 2026-10-30.

### Detail 160

**Every continuation across an Effect-type bang stays on the bang's line.** (Fable round-20 m1; reconciles Appendix A with VIP-3/001's existing line rule.) Place no-LineTerminator restrictions before each bang continuing an Effect type and after each bang when another bang or EffectOperand follows. The next slot begins on the same line as its bang; the two bangs in A!! likewise cannot be split. Multiline syntax inside a parenthesized slot remains ordinary TypeScript. Keep omitted slots as never; do not reinterpret an invalid trailing single bang as an inferred slot.
    Status: applied in main 0a207dbf; revalidated by spec-fix-a with the three existing Effect-bang grammar/source tests. No duplicate patch.
    ```vibe
    type Good = User!NotFound!Services
    type AlsoGood = User!!Services
    // type Bad = User!
    //   NotFound // syntax error: slot must start on its bang's line
    ```
    Effect TS: the corresponding Effect.Effect<User, NotFound, Services> or Effect.Effect<User, never, Services>; line restrictions select the already-decided surface grammar. Decided by the agent from VIP-3's existing same-line shorthand rule, principle 2 (TypeScript-style no-LineTerminator grammar conditions), and principle 4 (one continuation rule for every slot), 2026-10-30. This corrects the production/notes disagreement, not a new type-inference rule.

### Detail 162

**The derived platform ban applies to global bindings, with one explicit allowlisted-member exclusion.** (Fable round-20 m2; clarifies details 101/153/154.) The rule's domain is an IdentifierReference resolving to a global binding, or a statically named property of the standard globalThis that resolves to that global. It is not a general scan of every property symbol declared in lib.dom/lib.webworker/@types/node. Properties of an allowlisted data utility remain allowed, except the standard AbortSignal.timeout property explicitly covered by detail 154. The platform inventory records banned global bindings, the closed allowlist and this member exclusion separately. Retain resolved-binding shadowing, unresolved-name TS2304, and the existing globalThis access restrictions.
    ```vibe
    const url = new URL("/x", "https://example.test")
    url.searchParams.get("q") // allowed data utility, not a global-binding ban
    AbortSignal.timeout(100)  // EK4402: explicit timer-member exclusion
    ```
    Effect TS: the same pure URL operations; use Effect timeout/sleep for timers. Decided by the agent from detail 101's allowlist purpose, principle 3 (resolve the binding at the stated domain), and principle 4 (one global inventory plus one explicit member exception, not a ban on all DOM-declared properties), 2026-10-30. This makes the generator contract agree with its existing allowed utilities; it does not add another allowlisted name.

### Detail 170

**Pipe syntax is reachable from ShortCircuitExpression, with left-associated unparenthesized chains.** (live `900-pipe-grammar-entry`; VIP-23 snapshot reconciliation, extends details 131/145.) Add `PipeExpression[?In, ?Yield, ?Await]` to the effective `ShortCircuitExpression` alternatives alongside LogicalORExpression, CoalesceExpression and the effect-context CatchExpression. Keep the pinned `PipeExpression : ShortCircuitExpression |> PipeBody` and `PipeBody : AssignmentExpression`, carrying the enclosing VibeLang grammar parameters consistently. Extend the existing PipeBody covering-production early errors to reject a body whose whole unparenthesized expression is a `PipeExpression`. This excludes the right-associated alternative of an unparenthesized chain, leaving its unique sequential left-associated derivation. A parenthesized nested pipe remains allowed, with the pinned separate topic environment. The restriction concerns the whole body: do not ban every nested occurrence of a pipe. Retain detail 131's missing-topic correction, detail 145's evaluator on the actual ShortCircuitExpression child, and the existing conditional/yield/assignment/arrow restrictions.
    **Immutable-main source receipt (695576, 170).** Verified at immutable main `695576acb44b`: 002/AppendixA and the snapshot README provide a reachable ShortCircuitExpression pipe entry, sequential left-associated chains and explicit nested topic scopes. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in cb3692683d7d (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const one = 1 |> % + 1 // 2
    const chain = 1 |> % + 1 |> % * 2 // 4: (1 |> % + 1) |> % * 2
    const nested = 1 |> (% + 1 |> % * 2) // 4: explicit nested pipe, separate topic scopes
    ```
    Effect TS: `const t1 = 1; const t2 = t1 + 1; const chain = t2 * 2`; for explicit nesting, bind the outer topic once, compute the nested input from it, then bind the inner topic once. Decided by the agent from VIP-23's accepted sequential temporary counterpart, principle 2 (the pinned ShortCircuitExpression precedence and topic environments), and principle 4 (one reachable grammar with one chain derivation), 2026-10-30. This repairs the missing grammar reference and ambiguity rather than selecting a new operator meaning. Reconcile Appendix A, 002 and the vendored README while retaining upstream `spec.html`. Add one-stage, multi-stage, parenthesized-nesting and conditional-precedence witnesses; a reduced atom/pipe derivation probe is evidence for that fragment, not a full-language ambiguity proof.

Landing receipt: source cb3692683d7d landed in main 695576acb44b (queue 1793370871-spec-fix-a, gate mq-10302026-7).

### Detail 171

**Duplicate receipt: Signed-zero coverage; use detail 169.** The same rule was recorded concurrently under detail 169 before this receipt was appended. This item introduces no independent decision, does not supersede detail 169, and is excluded from decision counts. Additional reference evidence is in `decide-live-scratch/signed-zero-pipe-entry.log` (Effect `4.1.0`, grammar model only; no compiler claim). Consolidated by decide-live, 2026-10-30.

### Detail 172

**Duplicate receipt: Pipe grammar entry; use detail 170.** The same rule was recorded concurrently under detail 170 before this receipt was appended. This item introduces no independent decision, does not supersede detail 170, and is excluded from decision counts. Additional reference evidence is in `decide-live-scratch/signed-zero-pipe-entry.log` (Effect `4.1.0`, grammar model only; no compiler claim). Consolidated by decide-live, 2026-10-30.

### Detail 175

**Effect overload signatures follow TypeScript's async declaration positions.** (live `900-effect-overload-bodies`; VIP-1's accepted placement rule, not a new feature.) Admit a bodyless overload-signature alternative for an effect function declaration and an effect class method wherever TypeScript admits the corresponding `async` overload signature. Preserve TypeScript's signature ordering, adjacent implementation requirement, overload/implementation compatibility, modifiers and semicolon/automatic-semicolon rules, replacing the Promise result by the specified Effect result. Split declaration/method productions by syntactic position rather than making every `Block` optional. Function expressions, object-literal methods and arrows still require bodies. Do not add starred effect-function/method overload signatures: TypeScript rejects starred generator overload signatures with TS1222. Ambient async positions rejected by TypeScript do not become new effect-modifier positions. Ordinary inherited overload mechanisms remain as TypeScript defines them; a bodyless signature itself executes no code.
    **Immutable-main source receipt (695576, 175).** Verified at immutable main `695576acb44b`: 001/AppendixA state native async-like effect overload positions, ordering/compatibility/ASI, and class-versus-object method boundaries. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 2a1c089083b1 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    effect function pick(x: string): string!!;
    effect function pick(x: number): number!!;
    effect function pick(x: string | number) { return x }
    class C {
      effect m(x: string): string!!;
      effect m(x: number): number!!;
      effect m(x: string | number) { return x }
    }
    ```
    Effect TS: the same ordinary function/class overload lists returning `Effect.Effect<string>` or `Effect.Effect<number>`, with one implementation returning `Effect.gen(function* () { return x })`. Declaration output preserves each exposed signature and its Effect return type; effectful signatures still carry no synchronous `@throws`, and detail 138's implementation-bound checks remain. Decided by the agent from VIP-1's explicit rule that `effect` goes exactly where TypeScript allows `async`, principle 2 (inherit overload syntax/checking), and principle 4 (separate bodyless declaration positions instead of a universal optional body), 2026-10-30. Reconcile 001 and Appendix A with these alternatives and provide declaration-output witnesses. Evidence: `effect-overload-types.log` exits 0 under strict TypeScript and `effect-overload-reference.log` gives `Success("ok")`/`Success(7)` on Effect 4.1.0. `overload-position-check.log` independently accepts the function/class async overloads and rejects bodyless expressions/object methods, starred overloads and ambient async declarations (TS1005/1222/1040). These are native TypeScript/Effect reference checks, not VibeLang compiler-conformance evidence.

Landing receipt: source 2a1c089083b1 landed in main 695576acb44b (queue 1793370440-spec-fix-a, gate mq-10302026-7).


    **Unannotated effect overloads and recovery cover (Opus31m61/m63/m64).** Preserve TypeScript's bodyless-signature behavior: an omitted return annotation exposes `any`, with native `TS7010` when `noImplicitAny` is enabled. Do not infer that exposed signature from its implementation or invent `E`/`R`; an explicit Effect annotation supplies the checked contract. The source callable's effect kind, eager initialization and returned cold Effect stay unchanged. Unsupported interface/type-literal method and `abstract`/`declare` effect positions already assigned `EK0108` must be recognized by the rejection cover, without admitting them. Native independent errors remain native, and a starred bodyless generator signature retains `TS1222` under this detail.
    ```vibe
    effect function untyped(x: string); // TS7010 with noImplicitAny
    effect function untyped(x: string) { return x }
    effect function typed(x: string): string!!;
    effect function typed(x: string) { return x }
    ```
    Effect TS: `function untyped(x: string); function untyped(x: string) { return Effect.succeed(x) }`, with the same implicit-any/TS7010 behavior; annotate the typed overload `Effect.Effect<string>`. Decided by the agent from accepted VIP-1's written-or-inferred rule and async positions, detail175, principle2 (native signature/configuration checks), and principle4 (no new mandatory-annotation exception), 2026-10-30. `r31-overload-tdz-asi-reference.log` independently checks TypeScript5.9.3 native async and ordinary Effect-returning overloads: both expose any and report TS7010 only with noImplicitAny. This is native reference evidence, not VibeLang declaration, compiler, source-publication or cross-package conformance.

### Detail 177

**An empty switch case block is false in the do-ending early-error predicate.** (live `900-do-empty-switch`; VIP-2 pinned-draft reconciliation.) Define `EndsInIterationOrBareIfOrDeclaration` for `CaseBlock : { }` to return `false` for either value of `isLast` and any `labelSet`, just as the operation already returns false for an empty ordinary block. This supplies the missing zero-child production; implicit chain-production forwarding cannot supply it. Do not skip the operation only for a final statement: the statement-list prefix is checked with `isLast = false` too. Retain ordinary switch evaluation/completion and the existing forbidden loop/declaration/bare-if endings. An empty switch does not itself supply a value; its ordinary normal completion is `undefined` where the switch algorithm supplies it.
    **Current do-predicate conflict-repair source (ddcc0580).** Source `ddcc0580e1e6` is reported queued by spec-fix-a, superseding rejected `3d60171bb38d`. It retains both the complete empty-switch and added-loop static predicates/publicVIP2 amendment while preserving current main's call evaluation/source naming. Seven focused checks, exact strictTypeScript,43citations, regeneration/docs/tokens and the four-package spec target (30selected,27active passes,3retired skips) are attributed passes. No matching ORIGINS Circle, main landing or compiler conformance is claimed. Earlier29-target selection evidence remains historical rather than being silently reused as the current count.
    Status: applied in fdb225af998c (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const value = do { switch (0) {} 7 } // 7
    const empty = do { switch (0) {} }   // undefined
    ```
    Effect TS: the first is a same-activation statement sequence `switch (0) {}; return 7`, while the second ends after the empty switch and returns `undefined`; no new Effect operation is involved. Decided by the agent from VIP-2's admission of ordinary TypeScript statements inside `do`, principle 2 (the existing ECMAScript empty case-block production/completion), and principle 4 (one explicit false base case alongside the operation's empty-block case), 2026-10-30. State the reconciliation in the do snapshot README, 002 and Appendix A without editing upstream `spec.emu`. Evidence: `decide-live-scratch/root-do-empty-switch-reference.log` confirms the pinned predicate has neither an empty nor optional-no-default CaseBlock rule and records `Success(7)` from the ordinary-statement Effect `4.1.0` counterpart. Add both final/nonfinal witnesses; this is static-algorithm/reference evidence, not native-do or VibeLang compiler conformance.

**Replacement source queued:** 3fbdc9cdd5d3 (same bookmark9) supersedes rejectedfdb225af998c after rebasing onto main d50d73b32354. All three final tests fail against immutable raw-main inputs and six focused/grammar checks pass after; strict TypeScript5.9.3 and Effect4.1.0 controls pass. Fresh29 selected spec/cost functions, regen183/docs9/tokens/forms pass, no moved decisions. The repaired source preserves the current completion prose and explicitly acknowledges the snapshot reconciliations. ORIGINS grep finds no predicate/empty-switch Circle; earlier jump-target circles are outside this rule. Evidence do-predicates-refresh-* in spec-fix-a-scratch. This is queued source/native-reference evidence, not a main or compiler-emission receipt.

**Earlier complete replacement receipt (before corrected `ddcc0580e1e6`):** 3d60171bb38d (bookmark9) supersedes3fbdc9cdd5d3 and the original rejectedfdb225af998c. Includes the explicit public VIP2 static-predicate amendment required under213. Four final regressions fail on immutable raw main d50; seven focused/grammar checks pass after. Strict TS5.9.3/Effect4.1 controls, regen183/docs9/tokens/forms pass with no form moves. Final Go selection29 exits0 on daf7ddaa51ff:26 top-level passes,3 explicitly retired legacy-oracle skips, plus one intentional superseded fixture subtest skip; native worker dependencies are required. Earlier all29 wording meant the configured target exit0, not29 executed passes. No tests/gates were weakened. Rebased onto fetched f10f3e12c5bb with only generated token conflicts, regenerated and repeated focused7/docs9/tokens before enqueue. Evidence do-predicates-publication-* and final-spec-receipt.json. Queued source/native-reference receipt only; no main or compiler-conformance claim.

### Detail 184

**Effect arrow heads mirror TypeScript's separate bare and parenthesized async forms.** (live `900-effect-arrow-heads`; VIP-1 grammar repair, distinct from detail 175's overload signatures.) Split `EffectArrow` into a bare `BindingIdentifier` head and a parenthesized-formal-parameters head. Only the parenthesized branch may carry type parameters or a return annotation. Keep the simple bare-identifier arrow and its contextual parameter typing. Do not take an independent cross-product of optional type parameters, bare-or-parenthesized parameters and an optional return annotation. Preserve existing no-LineTerminator restrictions, Effect return-type checking, generic parameter rules and the two-modifier `EK0105` recovery; no new arrow position or ambiguity rule is introduced.
    **Immutable-main source scope (d0cdbe, 184).** 001/AppendixA now preserve complete is/as/satisfies expression-operator readings after ordinary effect/async identifiers; this publishes the later complete-head source clarification in addition to earlier695 arrow-head shapes. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    **Immutable-main source receipt (695576, 184).** Verified at immutable main `695576acb44b`: 001/AppendixA split bare Effect arrows from parenthesized generic/annotated heads. This verifies that source-head portion, not every later complete-head identifier-operator clarification or parser behavior. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 7b23123f61e5 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    const f: (x: number) => (number!!) = effect x: number!! => x // syntax error: parenthesize x
    const g: (x: number) => (number!!) = effect <T> x => x       // syntax error: parenthesize parameters
    const a: (x: number) => (number!!) = effect (x): number!! => x // allowed
    const b = effect <T>(x: T) => x                              // allowed
    const c: (x: number) => (number!!) = effect x => x             // allowed
    ```
    Effect TS: ordinary function values returning `Effect.succeed(x)` with the same checked heads/types; the native async syntax oracles are `async (x): Promise<number> => x`, `async <T>(x: T) => x` and `async x => x`. TypeScript rejects the two bare decorated heads with TS1005. Decided by the agent from VIP-1's explicit rule that `effect` occurs exactly where TypeScript permits `async`, principle 2 (inherit its async-arrow head grammar), and principle 4 (two existing head shapes rather than independently optional decorations that admit unapproved forms), 2026-10-30. Reconcile 001 and Appendix A and add both rejection witnesses and all three controls. `decide-live-scratch/root-effect-arrow-heads-reference.log` verifies those parser results with the installed TypeScript primary compiler API. This is grammar/reference evidence, not a VibeLang parser-conformance result; no runtime Exit claim is needed for this syntax distinction.

    **Complete-head lookahead preserves ordinary identifier operators (live `900-effect-is-head-disambiguation`).** The existing contextual expression rule selects an effect arrow/function/block only for its complete grammar head. Otherwise `effect` remains an ordinary identifier, including valid `effect as T`, `effect satisfies T`, and VIP-7 `effect is P` expressions. The identifier-spelled operators `as`, `satisfies` and `is` must not be consumed by invalid-shorthand recovery before that ordinary expression can parse. This restates VIP-1/VIP-7 and principle 3, not a new shorthand or a symbol-based parsing rule. Source repair reported queued as `64cc01266def`; its strict counterpart `Success(2)` is the fixer's receipt, not an independent compiler run by this lane. Decided by the agent from the accepted expression grammar and principles 2/3/4, 2026-10-30.

Landing receipt: source 7b23123f61e5 landed in main 695576acb44b (queue 1793369968-spec-fix-a, gate mq-10302026-7).

    Landing scope clarification: main `695576acb44b` publishes the ordinary bare-versus-parenthesized arrow-head shapes via `cf67082254d1`. This does not independently verify the later complete-head `is`/`as`/`satisfies` clarification or its separate `64cc01266def` source receipt. Preserve those distinct scopes rather than reading the earlier landing line as full delivery of every later184 follow-up.

Landing receipt: source 64cc01266def landed in main d0cdbe5a0a7f (queue 1793378613-spec-fix-a, gate mq-10302149-2).

### Detail 188

**Error-body methods include TypeScript class overload declarations.** (live `900-error-method-overloads`; VIP-13/VIP-29 method admission, distinct from detail 175's effect overload productions.) Classify TypeScript class method declarations and their bodyless overload signatures as accepted methods in both `error` and `schema error` bodies; do not send them to `RejectedElement` merely because ECMAScript's narrower `MethodDefinition` requires a body. This includes ordinary plain and async method overloads in the positions TypeScript admits. Preserve its ordering, adjacent implementation, compatibility, modifiers and declaration emission rules. Keep every explicit error-body restriction, including constructors, setters, static members and error type parameters. This does not generally admit ambient members, bodyless object-literal methods or starred overload signatures that TypeScript rejects.
    **Immutable-main source receipt (695576, 188).** Verified at immutable main `695576acb44b`: 003/AppendixA admit plain/async TypeScript class overload signatures in both error forms while retaining other rejected members. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 2a1c089083b1 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    error Plain {
      label(x: string): string;
      label(x: number): number;
      label(x: string | number) { return x }
    }
    schema error Encoded {
      label(x: string): string;
      label(x: number): number;
      label(x: string | number) { return x }
    }
    effect function use() { return [new Plain().label("ok"), new Encoded().label(7)] }
    ```
    Effect TS: ordinary subclasses of `Data.TaggedError("Plain")` and `Schema.TaggedError<Encoded>()("Encoded", {})` carrying those same overload lists and one method implementation each. Calls expose `string`/`number` results; only the implementation emits a body. Decided by the agent from VIP-13's explicit promise of methods as in a TypeScript class, VIP-29's shared member restrictions, principle 2 (native TypeScript method overload syntax), and principle 4 (one class-method category instead of treating ordinary overload signatures as unknown members), 2026-10-30. Reconcile 003 and Appendix A's member partition; test plain and async overload controls without relaxing forbidden forms. `decide-live-scratch/root-error-method-overloads-types.log` passes strict checking of both error counterparts; `root-error-method-overloads-reference.log` records `Success(["ok", 7])` on Effect `4.1.0`. These are class/counterpart checks, not VibeLang compiler-conformance results.

Landing receipt: source 2a1c089083b1 landed in main 695576acb44b (queue 1793370440-spec-fix-a, gate mq-10302026-7).

### Detail 189

**Appendix B inventories interim legacy diagnostics against the actual compiler revision.** (live effectscript-f3 Appendix-B note, 2026-10-30 09:00Z; VIP-34 documentation/retirement policy.) Keep a separately labeled compatibility inventory for legacy checks that a transitional compiler still prints, without adopting those checks as new language rules or moving them into unrelated VIP blocks. The three proposed `EK92xx` entries are identified by their actual registry messages and defaults: `EK9201` is an error for an expected failure outside the written error contract; `EK9202` is an error for a requirement outside the written requirement contract; `EK9204` is a warning for an old Effect try/catch block whose error channel is `never`. The finding's devtools/layers label is not the meaning of these declarations in the inspected candidate. Name their retirement owners: VIP-1/VIP-3 replace the first two legacy contract checks with ordinary checked Effect return types/assignability; VIP-5 removes the old Effect try/catch statement and its never-error warning. A `try e` execution of an infallible Effect remains valid and must still run. This interim inventory preserves printed-code documentation; it does not reserve a permanent VIP-92 feature family or revive old try/catch/implicit-program semantics.
    **Immutable-main source scope (f10f3e, 189).** All eight interim `EK9201`–`EK9208` definitions are now published with emitted severity, rule and retirement ownership. Source `1b4b52d9ac9e` landed as `3f79d28c65a7`; this is an inventory, not normative semantics or completed compiler retirement. `root-main-f10-source-receipt.json` records the full six-file design diff and exact eleven-row AppendixB check; no own compiler/docs/gate rerun.
    Earlier verification receipt: `1b4b52d9ac9e` was checked and queued by spec-fix-a, refreshing pre-alignment `e61f639550c8`; its later `f10f3e12c5bb` source landing is independently scoped above.
    ```vibe
    error Bad
    effect function bad(): number!! { throw new Bad() } // incompatible E: checked Effect return contract
    effect function run() { return try succeed(1) }     // valid: E = never is still executed
    ```
    Effect TS: the first is a function annotated `Effect.Effect<number>` that returns `Effect.fail(new Bad())`, rejected by ordinary return-type assignability; the second executes `yield* Effect.succeed(1)`. Decided by the agent from VIP-34's requirement to document every printed diagnostic, detail 60's ownership scheme, VIP-1/VIP-3/VIP-5's already-decided replacement semantics, and principle 4 (one explicitly transitional catalog rather than invented new language rules), 2026-10-30. Revision receipt: main `e5f29633` still defines these messages as `EK2001`/`EK2002`/`EK2004`; unlanded `vibe/alpha-diag-renumber-1` at `290949b7` renames them to `EK9201`/`EK9202`/`EK9204` in `typescript/tsc/internal/vibelang/diagnostics.go`, with defaults error/error/warning. The spec fixer must use the numbers actually present in its target artifact and revalidate this snapshot after that lane rebases/lands. Do not state that current main prints the proposed numbers or that this lane landed the candidate. Catalog other still-emittable compatibility codes from the same artifact under the same rule; this three-entry decision is not a claim of a complete registry audit. No runtime or native-compiler conformance test was run for this source inventory.

    **Versioned reuse note (Opus round24 m32; Fable round24 m10).** The reused-number list also includes `EK3006`: 0.0.10/current compatibility compiler uses it for a static service-member-name clash, whereas the accepted release catalog uses it for an invalid `vibe.severities` entry. Label the source/version and rule in both directions; a bare number is not a cross-version identity or permission to configure the new error. Keep the existing explicit `EK3008` compatibility-to-`EK0901` distinction in the accurately labelled implementation/compatibility registry, not as a competing normative assignment. This is inventory correction under details 60/189/194, not another renumber or reuse. Decided by the agent from principle 4 and the verified existing registry, 2026-10-30.

    **Producer code and diagnostic wording follow-up (Opus round25 m34/m35).** The reviewed VIP-21 amendment assigns `EK2128` to a valued `return` in an Effect producer, preserving historical identity instead of reusing `EK2101`. Read earlier log examples' producer-return `EK2101` as historical spec wording; the forward rule is `EK2128`. Record `EK2101` as retired, never available for a fresh assignment: historically it rejected a bodyless declaration whose return type was not an Effect, a restriction VIP-9 relaxed. A labelled compatibility inventory may still identify an older binary that emits it; do not revive that rule or pretend its old number is free. Restrict the producer check to source `effect function*`/producer methods; native `function*` and `async function*` retain their normal return values. A compiler applying it to a plain generator has an implementation bug under existing VIP-21, not a new language choice. The normative diagnostic catalog fixes the code, trigger, severity and required helpful explanation/fix; prose repair advice in a rule cell does not freeze an exact message string unless an explicit rule says so. VIP-34 requires helpful messages and mechanical fixes; it does not forbid a table from explaining a repair. A concise rule-only `EK2128` cell is a valid editorial cleanup, but the claim that any embedded repair text is a semantic defect is not adopted. Decided by the agent from accepted VIP-21/VIP-34, detail 60's no-changing-old-meaning code policy, and principle 4, 2026-10-30. The amendment was read in the exact round25 review input; source/queue/main state remains separately evidenced.

    **Full meaning-aware compatibility coverage (Fable round25 m10).** Do not describe a short reuse list or a registry test that compares only numbers as a complete identity audit. The same previously required versioned catalog also covers observed old/new meaning collisions for `EK2001`, `EK2002`, `EK2004`, `EK2005`, `EK2103`, `EK2104` and `EK3006`, alongside the already documented `EK2003`/`EK2102` history. Pin the old binary/source revision, current emitted rule and accepted release rule; distinguish a documented intentional version migration from an unresolved compiler/catalog mismatch. Preserve the earlier source-of-truth rule: do not claim a queued renumber is current main. Reject the proposed blanket statement that any old number in a VIP block is automatically free to acquire the new row's meaning; VIP-34/detail60 allows keeping an old code only for the same rule unless an explicit accepted migration says otherwise. The fix is complete versioned, rule-aware reconciliation and safe migration, not a compiler registry that passes by numeric equality alone. This broadens the existing inventory obligation, adds no new code or runtime policy, and does not assert the seven examples exhaust the registry. `root-new-code-registry-crosscheck.json` separately confirms that this lane's ten new0510/0705/modifier/schema/fiber/limit allocations do not occur in its saved immutable99c40510 diagnostics/core/options receipt; that is not a full historical audit. Decided by the agent from VIP-34/details60/189/194 and principle4, 2026-10-30.


    Current registry refresh: alignment30acb2d61d9a landed as e0671f9473e6. Source inventory applied in1b4b52d9ac9e covers all eight EK92xx definitions, including original three renumbered rows and four further legacy contract/inference/member checks plus9208 static-name clash. The full-block and migration tests fail on immutable main and pass after; all19 spec functions and native TypeScript/Effect4.1.0 controls pass. Earlier e5f29633/2001/2002/2004 descriptions above are versioned historical receipts. No actual native emission/conformance or source-main landing is claimed.

    Independent publication check: `root-batch695-source-receipt.json` and its exact Appendix B snapshot show no definition rows for `EK9201`–`EK9208` at immutable main `695576acb44b`. A live receipt associating the overload/decorator entry `2a1c089083b1` with this inventory was corrected; actual source `1b4b52d9ac9e` remains queued. This changes status evidence only, not the decided catalog or compiler behavior.

> **Rejected receipt association for this inventory (raw receipt retained):** Landing receipt: source 2a1c089083b1 landed in main 695576acb44b (queue 1793370440-spec-fix-a, gate mq-10302026-7).
> That entry publishes overload/decorator source, not compatibility rows. Immutable main `d0cdbe5a0a7f` still has zero definition rows for `EK9201`–`EK9208` and `EK4853`–`EK4855`; `root-main-d0cd-absence-check.json` is the targeted proof. At that earlier snapshot, actual inventory source `1b4b52d9ac9e` retained its separate pending receipt; its later f10f3e publication is scoped above.

Landing receipt: source 1b4b52d9ac9e landed in main f10f3e12c5bb (queue 1793389058-spec-fix-a, gate mq-10302307-6).

    Applied in ad934929e56a (spec-fix-a source queued; not a main landing receipt): full11-code historical reuse list plus explicit oldEK2101 retirement/non-reassignment and publicVIP21 companion. Current compiler-state test follows the separately labelled compatibility section; no message-literal contract is imposed. Full4-package spec30/27active+3retired,focused6/docs9/regen183/tokens/forms(no moves) pass. Restores/generalizes v15Opusm6 after6a6662ab6 and own7536/b715 history work; exact before/after/main receipts remain separate.

### Detail 194

**Appendix B lists the three existing VIP migration warnings at their emitted compatibility codes.** (live c9 main-RED migration-warning note; VIP-3/VIP-9/VIP-34 documentation, follows detail 189's artifact-accurate compatibility inventory.) Add explicit migration-warning rows for the current compiler's `EK4853`, `EK4854` and `EK4855`, each defaulting to warning and naming the accepted VIP it migrates. Keep these emitted numbers in the compatibility inventory until a coordinated compiler/docs renumber; do not document hypothetical replacement numbers while the compiler prints the old ones, or treat their `EK48xx` prefix as new language authority.
    **Immutable-main source scope (f10f3e, 194).** The actual `EK4853`, `EK4854` and `EK4855` migration warning rows and007/publicVIP3/9 explanations are now published by source `1b4b52d9ac9e`/main-copy `3f79d28c65a7`. Existing safe-fix/refusal and normative slot/service semantics remain; no whole migration implementation is certified. `root-main-f10-source-receipt.json` records the full six-file design diff and exact eleven-row AppendixB check; no own compiler/docs/gate rerun.
    Earlier verification receipt: `1b4b52d9ac9e` was checked and queued by spec-fix-a, refreshing pre-alignment `e61f639550c8`; its later `f10f3e12c5bb` source landing is independently scoped above.

    Prefix each Appendix B rule cell with `warning` (for example `warning — migration: …`) to follow the table's existing severity convention and retain the warning category.

    - `EK4853`, VIP-3: migrate a written omitted requirement slot whose old body inference would be lost by writing the previously inferred requirements explicitly. The normative omitted slot remains `never`; alternatively omit the whole annotation to infer the complete contract.
    - `EK4854`, VIP-9: migrate the retired abstract-class service spelling to a `service` declaration, retaining the intended member contract and key. An abstract class keeps ordinary TypeScript class semantics until explicitly migrated; recognizing a migration opportunity does not turn it into a service.
    - `EK4855`, VIP-9: migrate `static readonly default = shape` to `static readonly defaultValue = () => shape`, updating the corresponding type/value reads through the existing safe codemod. The accepted service API is the factory type `() => Shape`.
    ```vibe
    service Store { static readonly key = "app/Store"; value: number }
    effect function read(): number!!Store { return (try Store).value } // explicit requirements after VIP-3 migration
    service Flags {
      static readonly key = "app/Flags"
      static readonly defaultValue = () => ({ active: false })
      active: boolean
    }
    ```
    Effect TS: `read` declares `Effect.Effect<number, never, Store>`; `Store` is a Context.Service and `Flags` a Context.Reference with its ordinary defaultValue factory. The warnings select migration diagnostics/fixes; they do not execute an Effect or change omitted-slot semantics. Decided by the agent from VIP-3's explicit omitted-is-never ruling, VIP-9's explicitly approved service/defaultValue syntax, VIP-34's printed-diagnostic and breaking-change codemod requirements, and principle 4 (document already-implemented warnings in the existing compatibility catalog), 2026-10-30. Add VIP-3/VIP-9 amendments naming the relevant warnings and align 007/Appendix B, release notes and the fuzz/documentation oracle. Keep the existing safe-fix observation/refusal rules; this inventory does not authorize new trigger rules or arbitrary evaluation-order changes. Primary source receipt: `root-migration-warning-source.txt` at main `a706e483b4b1` shows `fix_omitted_requirement.go` registering `EK4853` and `fix_service_declarations.go` registering `EK4854`/`EK4855`, all warningCategory, with code-fix providers. User release notes already cite all three. c9 reports FuzzCompile oracle failures for the first two; this lane checked source/VIP consistency and did not run or claim to fix the native fuzzer. No additional Will choice is needed.


    Independent publication check: immutable main `695576acb44b` has no `EK4853`/`EK4854`/`EK4855` definition rows, as retained in `root-batch695-source-receipt.json`; source `1b4b52d9ac9e` remains queued with the92xx inventory. The separate overload/decorator landing does not complete this delivery.

## Items added by lane spec-robust, 2026-10-30 (Will: "go deep ... try really hard to do the robust fix on all of these"; each rule is a precedent, not a recipe; design in `robust-fixes.md`)

Landing receipt: source 1b4b52d9ac9e landed in main f10f3e12c5bb (queue 1793389058-spec-fix-a, gate mq-10302307-6).

### Detail 195

**Leaving a `match` behaves as leaving a `for…of` body.** (Amends 117, 123, 146; settles v15 opus m10, v19 opus M1, m6, v20 opus M1, m5, astra m2.) However a `match` or `is` test ends, cached iterators close first, then control goes on. A closing error replaces a value or a jump, as in `for…of`; a pending throw with a closing error is the draft's `AggregateError`. `FinishMatch`'s "abrupt completion" is read as "throw completion": `gen.return(5)` at a `yield` in an arm reaches that step with no `do` at all. A no-match error is `new TypeError()`. Every `throw` in effect code abandons the generator, wherever it stands, and abandonment is defined once, in 008.
    Status: applied in 12d6a3b9ce5e on main (source/cross-reference revalidated by spec-fix-c; no duplicate patch). Native completion/Exit regressions pass in main-decision-receipts.log.
    ```vibe
    function* numbers() { try { yield 1; yield 2 } finally { log("closed") } }
    function first() { const v = match (numbers()) { when [let a, ...]: do { return a }; default: 0; }; return -1 } // 1, logs closed
    ```
    Effect TS: `for (const a of numbers()) return a`. Decided by the agent from the do proposal's Evaluation, the match draft's own notes and ECMA-262 IteratorClose, 2026-10-30.

### Detail 196

**`return`, and an outward `break` or `continue`, are syntax errors in `async match`.** (New; VIP-7.) The match explainer says "just like `async do` expressions", whose grammar is `Block[~Yield, +Await, ~Return]`.
    Status: landed on main 1d56b687ec64 (commit e5a3bcd3c466; spec-fix-c, queued as 6efef4e0b1cc): async-match body contexts.
    **Immutable-main source portion (098e7a, 196).** 004 now cites VIP7 itself for async-match outward-jump restrictions rather than presenting an async-do analogy as adopted syntax; accepted subject/test/arm contexts remain. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    Status (async-match jump grammar): source fixed in 5a1389f203172febe59460ba6e1ea9a56d95cb59 (spec-fix-c; queued, not yet a main receipt). The later async-do citation clarification has a separate source-delivery requirement.
    ```vibe
    async match (x) { default: do { return 1 }; }   // syntax error
    ```
    Effect TS: none. Decided by the agent from the pinned explainer and TC39 `proposal-async-do-expressions`, and principle 8, 2026-10-30.

    **Citation erratum and syntax boundary (Fable round23 m8).** The accepted VIP-7 amendment and its incorporated match explainer settle this restriction; an unvendored `proposal-async-do-expressions` grammar is not an additional normative pin or accepted language feature. The earlier provenance sentence above cited that separate proposal too broadly. State the async-match restriction directly as VibeLang's accepted rule and its already-written nested-async-function counterpart, including the explicit reconciliation for outward jumps. `async do { ... }` is not admitted `.vibe` syntax by VIP-2/VIP-7; no accepted VIP adds it. The Promise analogy in 002 may explicitly label the separate proposal as non-language illustration, or use a nested async function instead, but must not imply that `effect { }` desugars to Promise syntax or that the vendored ordinary-do grammar defines async-do. Remove or qualify the unsupported return/grammar citation in 002/004/VIP-7 and the vendored README; no new vendored proposal is required. Keep ordinary `do`'s source completion behavior and async match's existing boundary unchanged. Effect TS: `async match` continues to have the stated async-function behavior, and an Effect block continues to return `Effect.gen(...)`, with separate result kinds. Decided by the agent from accepted VIP-2/VIP-7, principle 2 (use the actual pinned source), principle 4 (no extra syntax by analogy), and principle 8 (an unaccepted feature remains excluded), 2026-10-30.


    **Citation/syntax clarification, 2026-10-30 (Fable r23 m8).** No accepted VIP adds `async do` to `.vibe`; the pinned ordinary do-expression snapshot does not supply that separate proposal. Any comparison with `async do` is informative and must identify it as outside VibeLang. The `async match` return/outward-jump restrictions above are the explicit accepted VIP-7 rule, with its own `~Return` context; no new normative proposal/vendor pin is required to state them. Do not explain the return prohibition by saying an ordinary async arrow forbids its own return: it does not. Its source-function boundary prevents outward jumps, while `async match` separately disallows source return under this rule. Generated async counterparts may return arm results normally. This repairs the citation without admitting new syntax, changing the rule, or asking Will to reconfirm the accepted grammar.
    Appendix A roots: landed on main 4e088ab33903 (commit 8eae3b952347; spec-fix-c, queued as aec45290ced6).

### Detail 197

**A jump in a default leaves the pattern as from a `for…of` body; `return` in a parameter default acts as `return` at the top of the body.** (Replaces the lowering in 68, 68a, 68b; keeps 68c, 118, 176; deletes 68's temporal-dead-zone exception: JavaScript has none, and the compiler can keep it by binding `let` in order. The parameter half of 68 and 68a stays superseded by Will's ruling of 2026-10-30.) ECMA-262 hands IteratorClose the completion, so `const [x = do { return 9 }] = xs` calls `xs`'s `return` once. Native oracle: `gen.return(9)` at a `yield` in the default.
    ```vibe
    effect function j(xs: Iterable<number | undefined>) { const [x = do { return 9 }] = xs; return 0 }   // Success(9); return() called once
    ```
    Effect TS: `for (const v of xs) { if (v === undefined) return 9; break }`, for this witness. Decided by the agent from ECMA-262 and the do explainer, 2026-10-30.


    Applied in 8deb35e468a5485f9c5fe71424a971e314b8d127 (spec-fix-d/bookmark35; accepted independent replacement, not main). Original five regressions/runtime witness retained; immutable-main4docfail/native1pass, afterNode5/Bun5/strict/native and24 native async controls pass. Fresh final spec/docs/regen/forms pass without decision moves; originalbb9d retired only after acceptance. Preserves permitted default returns and native ordinary generator phases.

    Applied in f7f461bc9fc5564902d9e65c65da88ffb397b38a (spec-fix-d/bookmark39; complete35 replacement, queued not main). All original source/tests/runtime retained; stale quotation repair preserves programs/diagnostics/pending records and enables existing quote/coverage tests in fast gate. Rebasedfb3 expanded spec/docs/forms pass; queued8deb retired only after replacement acceptance.

### Detail 199

**`fork` evaluates its operand on the caller, and its quick fix keeps it there.** (Replaces the fix text of 99, 105 and 161, with 161's Exit.) The fix for `fork e catch h` is `fork Effect.catch(e, ($e) => Effect.succeed(h($e)))`, or `fork Effect.catch(e, h)` for an `effect` handler: no temporary, source order kept for `fork.in`, valid in any expression position.
    ```vibe
    const c = fork Effect.catch(worker(try id()), (e) => Effect.succeed(recover(e)))
    ```
    Effect TS: `yield* Effect.forkChild(Effect.catch(worker(yield* id()), (e) => Effect.succeed(recover(e))))`. Decided by the agent from Will's mapping (`fork e` is starting a Promise without awaiting it) and detail 161's intent, 2026-10-30.

### Detail 202

**An iterable argument's iterator is a protocol hook; a `dual` data-last call builds a function.** (Extends 81; settles the two disagreements between Appendix E and `throws.json`.) `for (const x of it)` tracks nothing, so `Array.from(it)`, `new Map(it)` and `new Set(it)` are `never`. `dual(arity, body)` runs `body` only with every argument, so `retry(p)` is `never`.
    ```vibe
    effect function f(it: Iterable<number>) { return Array.from(it) }   // ok; a throwing next() is a defect
    ```
    Effect TS: `Effect.gen(function* () { return Array.from(it) })`. Decided by the agent from the `for…of` precedent and detail 81's hook list, 2026-10-30.


## Continuous decide-live follow-ups, 2026-10-30

### Detail 209

**`for concurrent` allows a line terminator after `for`, as native `for await` does.** (Opus round22 m21; live `900-for-concurrent-line-break`; VIP-19/VIP-20 grammar clarification.) Remove the special `[no LineTerminator here]` between `for` and `concurrent` from Appendix A and align the contextual table. VIP-19 names `for await` as its syntax precedent and imposes no special same-line condition; `for try` already admits this spacing. Both layouts select the same concurrent-loop production and Effect counterpart. Keep every independently required restriction inside expressions and other construct heads. Ordinary `for (concurrent of xs)` is unchanged; a bare identifier immediately after `for` is not a competing ordinary TypeScript loop production, so no previously valid program acquires a different parse.
    **Immutable-main source scope (d0cdbe, 209).** AppendixA permits the for/concurrent line break under native for-await precedent. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in d473423f4ab3 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    effect function visit(xs: readonly number[]) {
      for
      concurrent (const x of xs) { try consume(x) }
    }
    ```
    Effect TS: `yield* Effect.forEach(xs, x => Effect.gen(function* () { yield* consume(x) }), { concurrency: "unbounded", discard: true })`, identical to the single-line spelling. Decided by the agent from principle 2 (mirror the native TypeScript/ECMAScript `for await` token boundary), VIP-19's explicit prior art, and principle 4 (remove an unmotivated spacing exception), 2026-10-30. This admits one previously rejected formatting variant without changing an existing valid program's meaning or a public API, so it is class A, not a new Will choice. Add positive single-line/newline grammar controls and retain ordinary-for controls when the source/implementation is updated; no new diagnostic is needed. `for-line-break-reference.log` passes strict TypeScript 5.9.3 and native Node `for\nawait`, plus the Effect 4.1.0 `forEach` reference. Those are native/reference checks, not a claim that today's VibeLang parser accepts the new layout or that a source change has landed.

Landing receipt: source d473423f4ab3 landed in main d0cdbe5a0a7f (queue 1793378252-spec-fix-a, gate mq-10302149-2).

### Detail 211

**Effect slots consume ordinary TypeScript type operands; optional `R` uses that same category before expression parsing.** (Opus round23 M7; live `900-effect-bang-slot-lookahead`; VIP-3/details 47/80/160.) After the adjacent double bang in the omitted-error form `A!!` on the same line, consume an optional `R` operand when the following tokens start a valid ordinary TypeScript type-operator-level operand, preserving the existing exclusion of an unparenthesized `{` and all existing bang/union/intersection/conditional restrictions. Prefer that present-slot production over omitted `R`; there is no value/type-symbol lookup or whitespace-based choice. An ordinary negative literal type remains admissible and is consumed as `R`; do not adopt the proposed blanket `-` exclusion, which would change currently admitted code. Parenthesize the whole assertion to subtract from its value. Parser-only JSDoc nullable/non-nullable/all forms (`?T`, `T?`, `!T`, `*`) are not ordinary TypeScript source types and are not Effect operands, even inside parentheses. At an optional-slot boundary their prefix tokens do not start `R`: `?` and `*` remain expression operators where that enclosing expression admits them; an additional `!` remains subject to the existing bang/non-null rules, not a JSDoc requirement. Explicit malformed JSDoc operands receive the ordinary invalid-type diagnostic, not new syntax. This is a grammar/category clarification, preserving existing valid negative requirements rather than adding another language exception.
    **Immutable-main source portion (098e7a, 211).** 001/AppendixA/publicVIP3 publish the complete ordinary-source slot boundary policy: negative R, JSDoc exclusion, required object slots, optional tuples, angle/bracket cases and complete as/satisfies parses with present-R priority and no symbol lookup. Complete13-file,82,844-character diff independently read. Source publication only; no own compiler/native/gate check. `main-098-source-receipt.json` records exact scope. Independent root review is retained in `root-main098-source-receipt.json`.
    **Immutable-main source receipt (54182a, 211).** Immutable main `54182a644026` narrows AppendixA prose to R after adjacent !! for the brace exclusion. This lands that prose correction only; it does not establish the entire later ordinary-operand/tuple/angle/as/satisfies grammar or parser implementation.
    Status (ordinary-source operand category/present-R/negative/JSDoc portion): source fixed in edb829e6a8aa (spec-fix-a; queued, not yet a main landing receipt). The later tuple-optionality clarification is not independently covered by that receipt.
    ```vibe
    type NegativeRequirement = number!!-1 // Effect.Effect<number, never, -1>
    const chosen = x as number!! ? 1 : 2 // omitted R, then conditional expression
    const product = x as number!! * 2 // omitted R, then multiplication (ordinary type checking still applies)
    const slot = x as number!! - 1 // R is the negative literal type -1
    const subtract = (x as number!!) - 1 // parenthesized omitted-R assertion, then subtraction
    ```
    Effect TS: `type NegativeRequirement = Effect.Effect<number, never, -1>`; `x as Effect.Effect<number, never, -1>` for the consumed negative requirement, and `(x as Effect.Effect<number>) - 1` for the explicitly separated expression, with ordinary TypeScript operand diagnostics. Decided by the agent from VIP-3's exact type-alias promise, principle 2 (ordinary TypeScript source types, not parser recovery/JSDoc types), principle 3 (syntax-only selection) and principle 4 (one slot category), 2026-10-30. `root-type-slot-native.log` and `root-type-slot-check.log` check TypeScript 5.9.3: `-1` is a valid literal type, while the four JSDoc forms produce TS17020/8020/17019. Existing compiler source also consumes same-line negative types; that is a preservation receipt, not a new compiler-conformance run. Update 001/Appendix A and test both type and expression positions.

    **Tuple optionality clarification (Opus round24 M7).** A `?` that TypeScript's enclosing tuple grammar accepts marks the completed Effect element optional; it is not a nullable/JSDoc suffix inside a slot. Thus `[A!E?]` means `[(Effect.Effect<A, E>)?]`, and `[A!!?]` means `[(Effect.Effect<A>)?]`; likewise an optional element may contain an already-consumed negative requirement. The optional tuple element still admits omission and contributes `undefined` on indexed access as ordinary TypeScript does. Outside a tuple or other independently admitted TypeScript punctuation context, a stray postfix `?` is not a source type. Keep the conditional-expression example's `?` outside the assertion too. Decided by the agent from principle 2 (native optional tuple grammar) and this detail's exclusion of parser-only JSDoc types, 2026-10-30; no new slot or nullable-type form.

    **Required-slot brace clarification (Opus round26 M7 / DIFFCHECK open item1).** The unparenthesized `{` exclusion belongs only to the optional R after adjacent `!!`, where it leaves a function body available. It is not an exclusion from EffectOperand generally and does not apply to a required error operand or the required R of `A!E!R`. Therefore `type T = A!{ reason: string }!{ service: number }` is admitted with the ordinary Effect.Effect<A, { reason: string }, { service: number }> meaning; `number!string!{ a: string }` is valid. For the omitted-error spelling, keep `A!!({ service: number })` when an object requirement is intended; `A!! { ... }` retains its existing body boundary where a function body is allowed. Do not turn the current parser's shared-slot `{` skip into a new language ban. Required-slot missing/extra bangs retain the existing errors and all slots exclude JSDoc-only source types. Add positive required-object-slot cases alongside optional-R/body, conditional/subtraction and tuple controls. Decided by the agent from VIP-3's exact alias, the existing Appendix A production that limits this lookahead to A!!R, and principles2/4, 2026-10-30. This clarifies the published grammar; the installed old compiler's rejection is implementation evidence, not a permission change or a request for Will. The earlier queued edb829e6a8aa receipt is not independently claimed to cover this later required-slot case.


    **Optional-R angle/bracket boundary (Opus round27 M7).** A leading `<` does not start an ordinary operand at TypeScript's type-operator level: generic function types need parentheses in an Effect slot. Thus `x as A!! < 3` omits R and continues with the comparison, subject to ordinary operand typing, while `A!!(<T>() => T)` explicitly supplies a parenthesized function requirement. Preserve present-slot priority for the ordinary `[` tuple start: `x as A!![0]` supplies R=`[0]`, not value indexing; parenthesize `(x as A!!)[0]` to request a later element access (whose type is checked normally). Do not copy the parser's broad `isStartOfType` recovery set into the source grammar, and do not adopt the reviewer's blanket minus exclusion: negative literal requirements remain admitted under211. Effect TS: `x as Effect.Effect<A, never, [0]>` for the consumed tuple, or `(x as Effect.Effect<A>)[0]` for explicit element access. Decided by the agent from VIP3's existing type-operator operand category, principle2 (pinned TypeScript5.9.3 separates function-type lookahead in parseType from parseTypeOperatorOrHigher) and principle3 (syntax-only present-slot priority), 2026-10-30. This is the already-decided category applied to more tokens, with no new permission or Will question.

    **Assertion/check continuations and contextual type names (Opus30M7).** In an enclosing expression, preserve native `as`/`satisfies` continuations after a completed omitted-R assertion: `x as A!! as B` and `x as A!! satisfies B` have the ordinary chained assertion/check parse when consuming the intervening keyword as R would leave a stray B. The present-slot priority is between complete source parses, not a parser-recovery tree that strands the rest of the expression. Do not turn this correction into a blanket token ban: native TypeScript permits type aliases named as and satisfies. A pure type `A!!as`, a required slot or parenthesized requirement using those aliases, and an expression whose complete present-R parse is valid retain the ordinary operand category. For example `x as A!!as satisfies unknown` can consume R=as and then the native satisfies continuation; do not force an incomplete omitted-R alternative merely because the first token spells as. If both complete source parses survive, keep211's existing present-R priority. This is syntax-only, with no lookup of whether the alias exists, no native expression operator added to pure type positions, and no change to valid negative or object/tuple operands. Parentheses remain an explicit way to group a requirement or the whole assertion. Effect TS: `x as Effect.Effect<A> as B`, `x as Effect.Effect<A> satisfies B`, or `x as Effect.Effect<A, never, as> satisfies unknown` for the corresponding source parses, all with ordinary type errors where applicable. Decided by the agent from VIP3's exact alias/ordinary operand promise, principles2/3 (native contextual identifiers and syntax-selected operators), and the existing complete grammar/211 priority, 2026-10-30. root-round30-reference.log independently checks valid native as/satisfies type aliases and chained native assertions/checks under TypeScript5.9.3. The unknown-version c30 rejection is attributed implementation evidence, not language authority; no VibeLang parser run or new keyword reservation is claimed.

    Status (full operand boundaries): applied in 343b937c (spec-fix-a; verified and queued, not a main landing receipt), superseding edb829e6a8aa while retaining its source/tests. Adds all four later211 clarifications: optional tuple punctuation, required object slots, angle/bracket boundaries and complete as/satisfies parses. Five regressions fail on unchanged main b77fec1e; all10 focused/grammar tests, all23 configured spec/cost checks, three strict printed TS5.9.3 counterparts, seven native controls, Effect4.1.0 Success([0,0,true]), regeneration183/docs9/tokens/forms pass; no form decisions move. Generalizes the v4/v11/v15/v16/v20 slot-boundary Circle rather than excluding more tokens individually. Supplemental whole-Appendix snippet checking is separately non-green: four old-marker failures versus two on raw main, because earlier pending grammar errors alter the shared project's later diagnostics; all three added TS counterparts check individually. No compiler-conformance or whole-spec-snippet pass is claimed.



    **Complete source parses include native ASI (Opus31m66).** Apply this detail's complete-parse priority with ordinary TypeScript automatic semicolons. With `x as A!!as` followed by a line break and `B`, present-R can complete by native ASI, leaving B as a second statement; the omitted-R chained assertion can also be complete across that break. Present-R wins when both survive, as already decided. A same-line stray B cannot be repaired by invented ASI, so the native chained assertion reading wins there. Keep the existing same-line boundary immediately after adjacent bangs and all native continuation/ASI restrictions; no symbol lookup or new same-line heuristic after contextual names.
    ```vibe
    type as = unknown
    type B = unknown
    declare const x: unknown
    declare const B: unknown
    x as number!!as
    B // two statements; the preceding assertion supplies R=as
    x as number!! as B // one chained assertion
    ```
    Effect TS parses: `x as Effect.Effect<number, never, as>` then a new-line B is two statements; `x as Effect.Effect<number> as` then a new-line B is one. Ordinary type checking still applies. Decided by the agent from detail211's explicit present-R priority between complete source parses, VIP-3, principles2/3 (native ASI and syntax-only selection), and principle4 (no extra token/line rule), 2026-10-30. `r31-overload-tdz-asi-reference.log` checks both native TypeScript5.9.3 parses and same-line stranding; no VibeLang parser or implementation conformance is claimed.

### Detail 212

**Complete the diagnostic catalog for existing modifier, declaration and yield rejections without changing admission.** (Opus round23 M8/m24/m27/m29; VIP-1/VIP-15/VIP-16/VIP-21/VIP-34; details 60/175/188/189/194.) Use `EK0108` for a recognized `effect` modifier in a TypeScript-forbidden async-modifier position: `abstract`, ambient `declare`, or an interface/type-literal member. Keep ordinary TypeScript syntax/placement errors where the source is ordinary TypeScript; do not treat an identifier named `effect` as a modifier by symbol lookup. Bodyless function/class overload signatures follow detail 175, including native ASI and compatibility; do not adopt a universal optional method body, invent a mandatory annotation beyond the existing native/signature rules, admit generator overloads, or report `EK0108` merely for a valid overload. Allocate `EK1501` for `export default schema S ...`, `EK1502` for type parameters on a `schema` declaration, and `EK1603` for `export default data D ...`. Keep existing `EK0905` for service and `EK1305` for error/schema-error default declarations. The shared repair is to declare the name and write `export { Name as default }`; a generic schema can instead be an ordinary generic TypeScript factory, not unsupported schema-declaration syntax. These are the first unallocated codes in their owning VIP blocks after checking main, the shared detail log and live findings; do not spread `EK1305` across unrelated VIP blocks or renumber already assigned codes. Broaden `EK2104`'s prose to `yield` in an effect function, effect arrow or effect block that is not itself a producer, whether or not any producer encloses it. Source nesting, not the compiler's generated generator, determines yield ownership; region blocks still forward a producer's admitted yields, and a nested ordinary generator retains native yield. A nested plain nongenerator/arrow retains TypeScript's own yield restrictions; this clarification does not replace every native error by EK2104. Finally, a forbidden constructor/accessor gets the applicable Functions diagnostics and no redundant error-body category diagnostic: `async effect get` can still receive both `EK0104` and `EK0105`; replace the misleading word 'alone' rather than suppressing either.
    **Immutable-main source scope (f6fe7a, 212).** The mixed Effect/async block slice is published in001/AppendixA/B and publicVIP1/2: bothorders0105, removeasync forblockrepair. This receipt does not close the separately rejected formal-initialization source/implementation scope. `root-mainf6-source-receipt.json` and `root-mainf6-throws-audit.json` preserve reviewed-prose/structured-artifact limits; no full raw9.19MB human-read or owncompiler/Go/generator/test/gate claim.
    **Concurrent-operation citation-preserving replacement.** Source `d11ece0d20ca` is reported queued by spec-fix-a, superseding `7997c302656b`; this preserves the accepted four-operation scope and the exact valid normative citations. The fixer reports the existing `TestRunningRulesQuoted` before failure with eight of39 missing quotations, followed by seven focused passes, all43 current citations, regeneration/docs/tokens and the declared four-package spec target (30selected,27active passes,3retired skips). Earlier forms passed with no own moves. This is a source/test-oracle compatibility repair with unchanged Go oracle, no new language rule or diagnostic code. It is not a main/compiler-conformance receipt or an own test rerun.
    **Immutable-main source scope (d0cdbe, 212).** 001/006/003/AppendixA/B and public VIP1/13/15/16 publish0108,1501,1502,1603 and applicable paired0104+0105 error-member priority. This is only those catalog portions; parameter-scope, other body/family codes and later incomplete-form231 deliveries remain separate. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Publication status (error-member primary set): applied in `1502a983879a` (spec-fix-b; refreshed replacement queued, not a main receipt; rejected1c2ccacfdf81 guarded-superseded). Reconciles003/AppendixA/public VIP13: keep the applicable Functions diagnostics, including `EK0104` and `EK0105` together, without an extra error-body category. The owning Functions link replaces cross-VIP private numeric citations in the public VIP. One before documentation failure and Node1/Bun1 plus regeneration/forms/spec/docs passes are attributed to the fixer, with no new code or compiler-conformance claim.
    Status (forbidden constructor/accessor diagnostic set): applied in1c2ccacfdf81 (spec-fix-b; queued on main54182a64, not main landing).003/AppendixA prose/public VIP-13 preserve applicable Functions diagnostics and omit extra body-category errors; explicit0104+0105 chapter example. VIP code ownership check kept unchanged; Node1/Bun1/regeneration/forms/spec/docs pass. Other212 catalog portions retain their own receipts.
    Status (EK0108 and paired modifier diagnostics): applied in b4d20c69117e (spec-fix-a; queued, not a main landing receipt). Includes the message declaration and user-doc reference needed by the unchanged registry/docs gates, without adding a diagnostic producer. Compiler build, e2e, 19 configured spec functions and focused/text/docs checks pass. Schema/data allocations remain with spec-fix-c’s three specific claims.
    Partial application: chapter006, public VIP15/16 and the three declaration-catalog rows applied in 0ce4219b2f598a15229dbf70ea7a2dea3fe1532f (spec-fix-c; queued, not on main). Remaining001/002/003 and other Appendix changes stay with their owners; no compiler registration claimed.
    Status (EK2104 body ownership only): applied in 6411338995bd (spec-fix-a; queued, supersedes 55a23f3b05cc). Plain nested callables retain TypeScript diagnostics. Modifier and other catalog changes remain separate source work; the schema/data portion has its own partial source receipt above.
    ```vibe
    abstract class Bad { abstract effect read(): number!! } // EK0108
    export default schema S { value: number } // EK1501
    schema Generic<T> { value: T } // EK1502
    export default data D { A } // EK1603
    effect function badYield() { yield 1 } // EK2104: no source producer owns this yield
    error BadMember { async effect get value() { return 1 } } // EK0104 and EK0105; no redundant error-body row
    ```
    Effect TS: the permitted counterparts are ordinary named `Schema.Struct`/`Data.taggedEnum` declarations followed by `export { S as default }` or `export { D as default }`; generic factories remain ordinary functions. A normal Effect function returns `Effect.gen`, but its generated generator does not expose source `yield` syntax. Decided by the agent from VIP-1's accepted async-placement rule, VIP-15/VIP-16's nongeneric/schema and named-declaration grammars, VIP-21's source-producer yield ownership, VIP-34/detail 60's assigned diagnostic requirement, principle 2 (native overload/placement rules), and principle 4 (fill catalog holes without changing source meaning), 2026-10-30. Amend 001/002/003/006/Appendices A/B and relevant VIP notes together; preserve the separate compatibility inventory of actually emitted legacy codes. This is a spec catalog allocation, not a claim that any compiler emits these new codes or that an implementation landed.

    **Remaining syntax/check triggers (Opus round24 m14, same catalog completion).** Assign the verified free codes `EK1705` to an unsupported `fork` owner suffix such as `fork.other`, `EK1706` to a `fork.in(s)` scope operand not assignable to the pinned `Scope.Scope`, `EK1802` to an unsupported dotted `try` execution form such as `try.map x`, `EK1907` to a concurrency limit not assignable to the pinned `Types.Concurrency` (`number | "unbounded"`), and `EK0510` to an unparenthesized unary execution expression on the left of `**` (`try a ** b`; write `(try a) ** b`, likewise the unary fork/join heads). Preserve ordinary operand/TypeScript diagnostics and do not invent positive-integer/literal-range restrictions beyond the actual Effect contract. Expand `EK0302` to an extra unparenthesized bang/slot after a completed Effect shorthand, including `A!B!!` and `A!B!C!D`; explain intentional nesting with parentheses rather than guessing a correction. `EK1702` also covers a reserved `fork`/`join` used as an IdentifierReference in an object-expression shorthand (`{ join }`) in the reserved context; ordinary IdentifierName property keys/access and the plain-context shorthand remain allowed. Existing `EK1906`/`EK2005` reject every head declaration kind other than the admitted `let`/`const`, including `using` and `await using`, as well as their already-covered `var`/assignment heads. Underlying TypeScript assignability is the check for `EK1901`/`EK2004` and the named new operand codes; reuse existing any/never and union rules instead of a second recognition algorithm. All five new codes were absent from current main, the shared decision log and live findings when allocated; source/catalog changes must land together. Decided by the agent from VIP-3/5/17/18/19/20/34, detail 60's code ownership, principles 2/3 (native grammar and actual Effect types) and principle 4 (complete existing rules with one diagnostic per trigger), 2026-10-30. These assignments change neither admitted operator forms nor valid program behavior and do not claim compiler emission.

    **Parameter await/yield diagnostic scope (Opus round24 m3).** The existing forbidden-`await` check `EK0102` also covers directly evaluated formal-parameter initialization of an Effect callable, where source async initialization is forbidden; the existing forbidden-source-`yield` check `EK2104` covers formal-parameter initialization of Effect callables/producers as well as their nonproducer effect bodies. Stop at nested source callable/context boundaries: a nested ordinary generator still owns its yield, and an ordinary async callable keeps native await rules. This labels the already-forbidden eager parameter cases; it does not turn a parameter initializer into effect code or permit suspension. Keep the separate `try` outside-effect error `EK0501`. Decided by the agent from VIP-1/VIP-5/VIP-21's native async/generator parameter restrictions and principles 2/4, 2026-10-30.


    **Mixed async/effect block recovery (Opus round27 m39; detail46).** The already-rejected two-word prefixes also recognize a following block brace: `async effect { B }` and `effect async { B }` receive `EK0105`, consistently with the contextual trigger table. The EffectBlock recovery production can start with EffectModifier; its admitted alternative remains only `effect { B }`. Keep the existing no-LineTerminator restrictions and native ordinary-identifier/arrow/method distinctions. Recovering these sequences does not admit a Promise/Effect hybrid or plain `async { B }`. For a block, the valid direct quick fix removes `async` and leaves `effect { B }`; do not mechanically offer removing `effect` into invalid `async { B }`. The existing function/arrow fixes retain their own valid alternatives. Example: `const p = async effect { return 1 } // EK0105`, fixed to `const p = effect { return 1 }`. Effect TS for the repaired program: `const p = Effect.gen(function* () { return 1 })`; the rejected form has no accepted counterpart. Decided by the agent from detail46's two-modifier rejection, accepted VIP2's Effect-block kind, the existing contextual trigger table and principle4 (one diagnostic for the same rejected modifier combination), 2026-10-30. This is a diagnostic/recovery clarification of invalid code, not newly admitted syntax or a compiler-conformance claim.

    Mixed-block source companion applied in 0fa8509ad63a (spec-fix-a; queued, not landed): both orders use EK0105 and the valid block fix removes async. Both before failures, five final checks and all19 configured spec functions pass on alignment maine0671f9473e6; no new syntax or runtime hybrid.

    **Concurrent-operation catalog scope (Opus rounds29/30 m18; live `900-concurrent-operation-diagnostics`).** The existing `EK0501` execution-context rule and `EK1801` array-of-Effects operand rule cover all four VIP-18 forms: `try.all`, `try.race`, `try.any` and `try.allSettled`. Naming only `try` or `try.all` in Appendix B is an incomplete catalog, not an exception for the other operations. Retain readonly arrays/tuples and every existing per-operation native type/result rule; this does not make nonliteral heterogeneous `allSettled` tuples valid where their accepted Effect counterpart is not. No code allocation, context permission or runtime behavior changes.
    Earlier publication status (concurrent-operation scope, before corrected `d11ece0d20ca` replacement): applied in `7997c302656b` (spec-fix-a; fixer-reported queued, not a main landing receipt). Three immutable-main documentation regressions fail before; six focused/grammar checks, all configured spec functions, generation183/docs9/tokens/forms, native20-context/four-operand/four-Exit controls pass after according to the fixing lane. These are attributed receipts; this decision lane did not rerun them or verify compiler emission.
    ```vibe
    function plain() { return try.race [work()] } // EK0501: outside effect code
    effect function bad() { return try.any [1] } // EK1801: not an array of Effects
    effect function good() { return try.all [work()] }
    ```
    Effect TS: `Effect.gen(function* () { return yield* Effect.all([work()], { concurrency: "unbounded" }) })` for the admitted example, with VIP-18's existing `raceAllFirst`, `raceAll` and `Effect.exit`/all counterparts for the other operations. Decided by the agent from accepted VIP-18/VIP-26's shared run-context and collection rules, VIP-34's complete diagnostic catalog and principle4 (one existing rule covers its whole syntactic family), 2026-10-30. Documentation implementation is claimed by spec-fix-a; no compiler execution, source fix or landing is asserted here.

    Earlier status (formal await/yield scope plus existing body ownership, before queued `01fc7b967e07`): applied in a6a0885c7efd (spec-fix-a; verified and queued, not a main landing). Supersedes6411338995bd and keeps its body/native controls.001/002/AppendixA/B and publicVIP1/21 include direct formal initialization, retain nested source boundaries, and keep try0501 separate. Four new regressions fail on immutable main695576acb44b; final10 focused/grammar tests, all26 configured spec/cost functions, strict printed TS5.9.3 counterpart, fifteen native parameter controls plus positive nested boundaries, Effect4.1.0 Success(0), regen183/docs9/tokens/forms pass. No form decisions move. TypeScript emits2538 rather than2524 for the computed binding-key control; native Node rejects that same source with SyntaxError, so no native-module admission is inferred. Initial full-spec failure on cross-VIP code references was corrected with owner-rule links and all26 rerun green. No compiler producer, codemod or native Vibe conformance is claimed. The older param-default181d1b41163a proposed0201 for these cases; it needs reconciliation with this settled212 code scope before treating it as a compatible implementation delivery. Generalizes the v3/v4/v9/v16 source-yield Circle to parameter ownership rather than adding another outer-producer witness.

Landing receipt: source b4d20c69117e landed in main d0cdbe5a0a7f (queue 1793383166-spec-fix-a, gate mq-10302149-2).

Landing receipt (mixed-block slice only): source 0fa8509ad63a landed mainf6fe7a68d976 (queue1793388519-spec-fix-a, gatemq-10310025-11). This does not verify the separate rejected formal-initialization scope.
    **Independent f6fe7 source portion (212).** The mixed-block slice in001/AppendixA/B andpublicVIP1/2 is published: bothorderingsrecoverwith0105,removeasyncforblockrepair. This does not close the separatelyrejectedformal-initialization scope. Full27,227-character nongenerateddiffread; sourceonly, no decide-livecompiler/gaterun. `main-f6f-source-receipt.json` records limits.

    Applied in 01fc7b967e07 (spec-fix-a source queued; not a main landing receipt): complete formal0102/2104/0501 source boundary and nonproducer-yield ownership, with publicVIP1/VIP21 companions and current-main preserving conflict repair. The separately landed mixed-block portion remains0fa8509ad63a->mainf6fe7a68d976.


    Applied in df5d8fba02cc (spec-fix-a source queued, supersedes01fc7b967e07): complete formal0102/2104/0501/nonproducer-yield rule retained with every valid concrete body reference. Actual old batch references fail before;11focused/grammar,47runningcitations,Go reference setups,full32spec selection(29activepasses+3retired),regen/docs10/tokens/forms(no moves) pass. No compiler conformance or main landing claimed. Earlier01fc receipt remains historical.

    Landed error-member companion:1502a983879a -> mainfb3e966fa9fe (spec-fix-b21, officialmq-10310343-24). Applicable Functions set, paired0104+0105 witness, no redundant body category and corrected AppendixA clause delivered. Focused/native/regen/forms/docs and exact spec packages pass (admission-timeout retry recorded). This does not claim completion of the other212owner slices or compiler conformance.

    **Immutable-main source publication (773bddb1d57f, 212).** Chapter 002 and Appendix A/B publish `EK1705` (unsupported dotted `fork` owner), `EK1706` (non-`Scope.Scope` argument to `fork.in`) and `EK1907` (invalid concurrency type), plus the complete `const`/`let`-only head list for `for concurrent`/`for try`. The separately numbered dotted-`try` correction is detail 243. This is catalog/source publication, not diagnostic-emission proof. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

    **Immutable-main source publication (013cfa002833, 212).** Chapter 002 and Appendix B publish `EK0510` for an unparenthesized `try`, `fork` or `join` expression on the left of `**`, preserving the native `await` grammar and parenthesize quick fix. This completes that already-reserved catalog slice; it does not certify compiler emission or the separate `EK0302` clause. The full six-file diff was read; `source-013-publication.json` retains its hash and exact scope.

    **Unary exponentiation covers every execution head (Loop r4 Opus OPUS-7).** Existing `EK0510` applies when the unparenthesized left operand of `**` is any of `try`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join`. Each is the accepted unary execution-expression category, like native `await`; separate AST productions do not create a different precedence or diagnostic owner. Parenthesizing the whole execution expression removes this syntax rejection; independent numeric operand/type/context errors retain their native/assigned codes. Decided by the agent from the await-parity principle, accepted VIP-5/VIP-17/VIP-18 and existing212's `EK0510` allocation, 2026-10-31. Clarify002/AppendixB/public amendments under213; extend regression/spec-quoted fuzz heads to all ten spellings, with parenthesized and independent-context/type controls. No new code, syntax permission, numbered decision or VibeLang compiler proof.

    **Native engine oracle note (r1 apply receipt, existing212).** The apply lane reports that JavaScriptCore accepts `async () => await 2 ** 2` even though ECMA-262 and V8 reject it. Its portable spec test uses unary minus. Keep the normative ECMAScript unary/exponentiation restriction and `EK0510` for all execution heads; an engine bug is not a language permission or an unexplained exception to await parity. This is attributed evidence from `loop/r1/APPLIED.md`, not an own Bun/V8 rerun or VibeLang compiler proof.


    **212 native module-await scope, decide-live, 2026-11-02 (RC-35).** Accepted VIP-26's ordinary module top level and VIP-5's native-await rule do not grant suspension to a TypeScript namespace body. A namespace's runtime body is synchronous, even when it appears in an ES module; preserve the native `TS1308` for its direct `await`, literal/Promise operands, dotted namespaces and nested ordinary blocks. Real module-level transparent blocks and genuine nested async functions/arrows retain their native permission. Recognizing the native `await` expression for diagnostics must not mean granting permission to suspend, nor revive the legacy Effect-await helper.

    ```vibe
    namespace Bad { export const x = await Promise.resolve(42) } // TS1308
    namespace Good { export async function run() { return await Promise.resolve(42) } }
    export const answer = await Good.run() // valid native module-level await
    ```

    These are native TypeScript/JavaScript contexts; their counterparts are the identical TypeScript source, with the rejected `Bad` declaration omitted for the valid runtime control. No Effect execution wrapper or new diagnostic allocation is introduced. The successful-emission regression is real owner evidence: new Vibe accepts `Bad` and emits a sync IIFE with `await`, which Node rejects; the same fresh binary in ordinary `.ts` mode rejects it with `TS1308`. The owner supplies four bad and nested-async positive controls; root has not executed that Vibe compiler.

    Ordinary module validity also retains the existing reserved-`await` binding requirement: the unchanged `TestBugBashAwaitBinding` expects syntactic `TS1359` for function, arrow and destructured parameter bindings. Own stock TypeScript5.9.3 accepts the typed arrow `export const f = (await: number) => 1`, but Node26 rejects its erased ordinary-module JavaScript `export const f = (await) => 1`. This TypeScript-version discrepancy is explicitly retained; do not claim that particular TypeScript control rejected it, or use its acceptance to authorize invalid ES module output. Follow accepted VIP-26's ordinary JavaScript module guarantee and the existing reserved-binding regression; keep unrelated native `.ts` behavior separate. The TLA owner has claimed this fix-forward; no duplicate compiler change is requested here.

    Root native reference `native-await-boundary-reference/receipt.json` records four stock TypeScript static controls and four Node module-syntax controls: namespace `TS1308`, valid true module/async namespace controls, the typed-binding discrepancy, and rejection of both erased reserved binding and sync-IIFE await. No Vibe/TS7 parser/compiler, bugbash Go test, LSP, fuzz or gate ran here. Apply existing180/212/216, public VIP-5/VIP-26/VIP-34 and principles2/4/8; this is a settled native-context requirement, not a new syntax, permission, code or Will question.

### Detail 215

**Legacy severity maps retain their supported legacy effect until migration; modern severity entries win.** (Opus round24 m33; Fable round24 m9/m11; VIP-30 migration amendment; main source receipt `99c40510f59c3167a4bc0115f4dec2fcfe3d2211`.) Document both historical locations: root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics`, in `vibe.config.json`, `tsconfig.json`, `jsconfig.json` and extended configuration files through the existing config loader. Each historical map is an object from printed legacy diagnostic code to its supported severity string. Keep the existing legacy code/value validation and replacement/inheritance behavior while it remains present; this does not make every release code legal in the old map. For a diagnostic with a supported legacy override, apply it until migrated unless the effective modern `vibe.severities` entry for that same diagnostic/explicitly mapped port wins. Use the existing modern code/port identity mapping, never infer equivalence from a reused numeric spelling. Newly assigned release errors cannot be disabled by putting their code in an old map, and a release-only code such as `EK0801` is not silently accepted by the old validator. Modern entry validation/recovery remains details 57/59/208. Report configurable migration warning `EK3009` at each legacy map; configuring the warning off does not migrate, validate, erase or disable that map's supported legacy settings. Reject the proposed blanket 'legacy sets nothing' statement: the current category function explicitly reads the legacy map after modern precedence, and no accepted VIP retires that compatibility behavior. A future intentional removal needs its own accepted migration decision.
    Status: applied in 5214bd3c85327ad3750be03bd8942a7a65688301 (spec-fix-d; verified source revision, not enqueued during diagnostic-alignment hold; no main receipt).

    `vibelang --fix` moves an independently eligible map to root `vibe.severities`, including in extended configs, retaining JSONC comments, unrelated settings and existing modern entries. A map containing obsolete/nonconfigurable codes remains in place under the accepted migration rule until those entries are resolved; do not copy them into the release map or convert them into new configurable errors. Preserve existing code-identity migration safeguards. Explain that plain TypeScript ignores the custom root wrapper but reports its ordinary unknown-compiler-option error (`TS5023`) for `compilerOptions.vibelang`; VibeLang recognizing that legacy path does not change `tsc`. The configurable-warning table must be complete for its stated source revision, or explicitly say it lists examples: the current six own release warnings include `EK0508`, `EK0703`, `EK0801`, `EK3009`, `EK4609` and `EK4610`, separate from imported lint and any accurately labelled legacy compatibility catalog.
    ```vibe
    // vibe.config.json / tsconfig.json / jsconfig.json (JSONC, shown as configuration)
    // { "vibelang": { "diagnostics": { "EK4801": "off" } } }
    // A supported legacy setting still affects its legacy diagnostic; EK3009 requests migration.
    // A valid modern override for that diagnostic's explicit port takes precedence.
    // { "vibe": { "severities": { "EK3009": "off" } } } only hides the migration warning.
    ```
    Effect TS: none; compiler configuration and JSONC migration have no Effect runtime counterpart. Decided by the agent from the accepted VIP-30 safe-migration rule, VIP-34's behavior-preserving codemod requirement, principle 2 (preserve existing configuration behavior while clarifying its schema), and principle 4 (modern precedence over a labelled compatibility fallback, not two competing release schemas), 2026-10-30. This is class A because it preserves verified current behavior; making every legacy map inert would be a breaking change. `root-legacy-severity-main-source.txt`/`root-legacy-severity-receipt.json` record `category`/`releaseSeverity`, legacy validation, merge and migration at the exact main snapshot. They are source receipts, not a compiler execution or a claim that docs or a new implementation landed. Update 007/Appendix B/VIP-30 together with comment/location/precedence examples.


    **Earlier accepted source receipt (later rejected: legacy severity; stale007 warning context):** applied in9459b38506c58b177324c718b81f12dcd97aef80 (spec-fix-d/bookmark33, independent queued; not main). Rejected5214bd3c8532 superseded after acceptance. Both legacy paths/admission/inheritance and modern port precedence/warning-only suppression preserved alongside current modern recovery, whole-code policy and warning repairs. Original semantic/native assertions retained with narrow warning-table/message attribution fixes for the newer catalog. Immutable-main four doc controls fail/native control passes; candidate Node5/Bun5,64freshcompiler/TypeScript controls,actualtsc5.9.3root-key/TS5023controls and spec/docs/regen/forms pass with no form changes. ORIGINS legacy-key/comments/warnings-table entries are explicitly not Circles. No implementation/main or broad-green claim.

### Detail 216

**Class field and enum initializers reset the enclosing Effect context; static blocks do not execute Effects.** (Opus round24 corrected M3/m30; VIP-1/VIP-5/VIP-17; detail 32.) Mirror the pinned TypeScript parser's own source boundaries: a class field initializer and an enum member initializer are outside the enclosing Effect execution and contextual-keyword reservation context. Thus a `join(...)`/`fork(...)` there can call a source identifier even when the class/enum is written inside an effect function; it does not execute VibeLang's fiber operator. Explicit `try e`/fiber-execution syntax there retains the existing outside-effect diagnostic (`EK0501`/`EK1701` through recovery), and there is no implicit async or Effect initializer. Class heritage and computed class element names still evaluate in their enclosing source context, separately from the field initializer. Plain source method/function boundaries still reset context, and a nested explicit Effect callable/block creates its own normal context.
    **Immutable-main source scope (d0cdbe, 216).** 001/002/AppendixA/VIP17 publish source field/enum reset, contextual static-block reservation and separate execution permission. Later service-default235 application remains separate. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in 554f60ee7e77 (spec-fix-a; queued, not yet a main landing receipt). One source parsing/reservation/execution rule, public VIP-17 amendment and examples with Success([2,3,7]); ordinary TypeScript computed-field restrictions retained. Nine parser controls, eight strict fixtures, the TS1166 field control, exact strict counterpart and all19 configured spec functions pass.
    Static blocks are also outside Effect execution. Preserve the accepted enclosing contextual reservation where Appendix A already propagates `+Effect`: a static block of a class written in that reserved source context cannot use a bare `join`/`fork` as an identifier call and receives `EK1701` for the recognized construct. In a plain source context with no enclosing Effect reservation, keep VIP-17's explicit outside-code identifier promise: an ordinary user `join`/`fork` in a static block remains an identifier. Do not copy ECMAScript's unconditional `+Await` static-block grammar into a new global `fork`/`join` ban; VIP-17 did not reserve these names throughout a module or every plain class. Qualify the claimed 'exactly ECMAScript Await' analogy accordingly: keyword reservation and permission to execute are separate, and source module classification does not globally reserve the two VibeLang words. This preserves the existing plain-call meaning and static-block reservation while correcting the field/enum reset, rather than introducing an unapproved global restriction.
    ```vibe
    import { join } from "./helpers.vibe"
    effect function build() {
      class C { value = join(1) } // ordinary imported call in the field initializer
      enum E { A = join(1) } // ordinary call; native enum type/constant rules still apply
      class D { static { join(1) } } // EK1701: enclosing Effect reservation, no static-block execution
    }
    class Plain { static { join(1) } } // ordinary identifier call under VIP-17
    effect function bad() { enum E { A = try task() } } // EK0501
    ```
    Effect TS: field/enum calls remain the source helper calls in ordinary generated initializer code; an enclosing Effect function returns `Effect.gen` without placing `yield*` into those initializers. Source fiber operations only lower inside a permitted Effect activation. Decided by the agent from VIP-1's async placement/boundary precedent, VIP-17/detail 32's contextual-only reservation and explicit outside-code identifiers, principle 2 (pinned TypeScript field/enum parsing), principle 4 (source boundaries before lowering), and principle 8 (no implicit initializer execution), 2026-10-30. TypeScript 5.9.3 `parsePropertyDeclaration` clears Yield/Await for the initializer; `parseEnumDeclaration` uses `doOutsideOfYieldAndAwaitContext`; static blocks set Await but cannot execute it. `root-await-class-reference.log` and forced-execution `root-await-class-force.log` show script field `await(1)` calls the ordinary identifier even inside an async function, while modules globally reserve await and static blocks reject it. `root-enum-await-reference.log` distinguishes ordinary identifier calls from an actual forbidden await operand. These are native parser/runtime references, not VibeLang conformance. Amend 001/002/Appendix A/VIP-17 consistently; supersede earlier panel recommendations that reserved field-initializer identifiers or proposed unconditional plain-class static reservation.


    **Native module await identifier receipt (Fable29).** The reviewer's TypeScript5.9.3 checker accepts an await-named parameter of a plain function in a module, including one nested in an async function. This is checker admission, not executable native-module proof: root-round29-await-identifier.log independently gets zero checker diagnostics, then Node rejects TypeScript's emitted .mjs with SyntaxError (expected negative check; stderr retained). Preserve the existing32/216 custom fork/join reset at a plain source callable; those ordinary JavaScript identifiers do not inherit the native module-wide await reservation. Do not infer a new VibeLang ban from ECMAScript's reserved await spelling, or claim the invalid native emit runs. This is reference-quality clarification only, with no new syntax, diagnostic or decision count.

Landing receipt: source 554f60ee7e77 landed in main d0cdbe5a0a7f (queue 1793386345-spec-fix-a, gate mq-10302149-2).

    **Catalog follow-up (decide-live; immutable main `969ea00c4aa3`).** The216 source boundary is published, but AppendixB's short `EK1702` row still limits its named-binding trigger to “effect code” and listed parameter contexts, while AppendixA explicitly excludes static blocks from effect execution. Align that row with002's existing `[+Effect]` reservation trigger, including inherited static blocks. For example, `effect function f() { class C { static { const join = 1 } } }` requires `EK1702`; a plain-context static block may still bind/call a helper named `join`, and an operation in a reserved static block remains `EK1701`. This is the already-settled216 rule, not a new prohibition or diagnostic allocation. The earlier source landing is valid for its published portions; it does not establish complete catalog alignment or compiler conformance. Existing `spec-fix-a` source ownership is retained; no source patch was made. `main-216-catalog-followup.json` preserves the exact contrasting main lines.

    **Immutable-main source publication (773bddb1d57f, 216).** Chapter 002 and Appendix B explicitly include reserved `fork`/`join` shorthand properties under existing `EK1702`, while property keys and member access remain names. This follows the already-published `await`-like reservation; it is not a new rule or VibeLang compiler proof. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

### Detail 219

**Promise-producing tagged templates use the existing explicit Promise bridge rule.** (Sol round26 m4; VIP-4; details 89/112/115.) A tagged template invokes its tag even though TypeScript represents it as `TaggedTemplateExpression`, separately from `CallExpression`. In Effect code, apply `EK0404` to that invocation when its selected signature/result satisfies the existing Promise/thenable predicate, including detail 89's union rule. Add tagged templates explicitly to 003 and Appendix B's trigger list; do not make syntax-tree node names an exception to VIP-4's 'always wraps a Promise'. An async tag's synchronous thrown type can be `never`; that does not exempt its Promise result. Preserve the native tag Reference receiver, once-only template/substitution evaluation, template-site identity and ordinary evaluation order inside the bridge thunk. This does not auto-await a tag, grant optional tagged-template syntax, change untagged templates, or alter the existing ordinary-async execution boundary.
    **Immutable-main source scope (d0cdbe, 219).** 003/AppendixB/VIP4 include Promise-producing tagged-template invocations in the existing explicit bridge, retaining native receiver/template/substitution semantics. `root-main-d0cd-source-receipt.json` retains the complete31-file diff/hash/read scope. Source only; no decide-live compiler/gate rerun.
    Status: applied in250412a0c2cf (spec-fix-b; queue accepted/held, not main).003/AppendixB/public VIP-4 trigger reconciliation; Node3/Bun3, strict TS5.9.3 node-kind/result proof, Effect4.1.0 native protocol/failure controls, regen/forms/spec/docs pass.
    ```vibe
    async function tag(_parts: TemplateStringsArray) { return 7 }
    effect function bad() { const p = tag`x`; return 0 } // EK0404
    effect function good() { return try tryPromise(() => tag`x`) }
    ```
    Effect TS:
    ```ts
    function good() { return Effect.gen(function* () { return yield* Effect.tryPromise(() => tag`x`) }) }
    ```
    The native invocation remains in the thunk and the pinned Effect bridge succeeds with `7`. Decided by the agent from accepted VIP-4's explicit Promise requirement, principle 2 (tagged templates are invocations with ordinary selected signatures), principle 3 (syntax selects invocation behavior, not the tag's spelling), and principle 4 (one Promise result rule for invocation forms), 2026-10-30. `round26-reference.log` independently checks strict TypeScript 5.9.3's separate node kind and `Promise<number>` result plus the Effect 4.1.0 bridge. This clarifies the already-required invocation check; no VibeLang compiler acceptance/rejection, API change or landing is claimed.

### Detail 224

**Use `EK0706` for the already-forbidden jumps out of `async match`.** (Opus round28 m47; VIP-7/VIP-34; details 60/196/214.) Assign `EK0706` to a source `return` belonging to an `async match` evaluation context, or a source `break`/`continue` whose resolved target lies outside that async-match boundary. This covers the subject, pattern tests/guards and arm result expressions under their existing source grammar parameters, including a `do` that would otherwise transfer control out. It adds no new restriction: detail 196/VIP-7 already reject those jumps. A nested source function retains its own return context, and a jump to a target inside the async-match boundary keeps its existing rules. Resolve source boundaries/targets before any generated async wrapper; do not report every syntactically nested return as forbidden or treat the generated function as a permission to escape. Keep ordinary independent native/control-flow diagnostics where they apply.
    Status: landed on main ab92e0dad56f (commit 983c76ba027f; spec-fix-c, queued as 0bea81a644cb).
    `EK0705` remains detail 214's parameter-home `is` binding error; do not reuse the reviewer's proposed number. Main's Appendix B has `EK0701`–`EK0704`, and the decision ledger reserves `EK0705`; `EK0706` was unassigned in both sources and the coordination claims when reserved. Catalog the new identity in 004/Appendix B and a public VIP-7 amendment under detail 213. Valid mixed modifier recovery and the imported-lint ranges are separate rules. Any suggested rewrite must preserve control flow; there is no automatic jump across the Promise boundary.
    ```vibe
    const bad = async match (0) { when 0: do { return 1 }; default: 0; } // EK0706
    const good = async match (0) { when 0: (() => { return 1 })(); default: 0; }
    ```
    Effect TS: no runtime counterpart exists for the rejected outward jump. The admitted nested-function case uses the existing plain async match counterpart, with `(() => { return 1 })()` as its ordinary arm expression and a Promise result; bridging that result from Effect code remains VIP-4's rule. Decided by the agent from accepted VIP-7/detail196's explicit boundary, VIP-34's coded language diagnostics, principle4 (one diagnostic for one existing source boundary), and detail60's agent-owned allocation rule, 2026-10-30. This is a diagnostic assignment, not new language admission, a new runtime API or a claim that the current compiler emits the code. Source and regression implementation remain with fixing lanes.


    **Independent allocation receipt:** root-round28-diagnostic-registry.txt and root-round28-main-revision.txt retain the actual diagnostic source at fetched immutable mainb0387e3558d9. Both printed EK0706 and numeric706 are absent there; the shared decision/live logs reserve0705 for214 and had no0706 assignment before224. This is a source/allocation check, not compiler emission or a full historical-code audit.

### Detail 238

**A pipe is never an unparenthesized conditional test.** (Opus r31 M9; VIP-23 pinned explainer precedence; extends details 145/170.) Keep detail 170: `PipeExpression` stays a `ShortCircuitExpression` alternative and chains stay left-associated. Add one early error: in `ConditionalExpression : ShortCircuitExpression ? AssignmentExpression : AssignmentExpression`, it is a Syntax Error if the `ShortCircuitExpression` is an unparenthesized `PipeExpression`. The pinned explainer gives `|>` the precedence of `=>`, assignment and `yield`, looser than `?:`, and rejects a conditional as a pipe head or body. Babel 7.29.11 and 8.0.4 (Hack pipes, `%`) reject `x |> f(%) ? 1 : 2` with "Hack-style pipe body cannot be an unparenthesized conditional expression". With this error the program has one answer, a syntax error, and 002 "not a change of precedence" becomes true. Unchanged: a pipe inside either branch (`c ? x |> % : y`, `c ? a : b |> % + 10`, detail 145), a parenthesized test and a parenthesized body. No `EK` code: it is a syntax error like the pinned pipe early errors.
    ```vibe
    const a = x |> f(%) ? 1 : 2     // syntax error: write (x |> f(%)) ? 1 : 2 or x |> (f(%) ? 1 : 2)
    const b = (x |> f(%)) ? 1 : 2   // the pipe result is the test
    const c = x |> (f(%) ? 1 : 2)   // the conditional is the body
    const d = ok ? x |> % + 1 : 0   // a pipe in a branch stays valid
    ```
    Effect TS: `const t1 = x; const b = f(t1) ? 1 : 2`; `const t2 = x; const c = f(t2) ? 1 : 2`; `const d = ok ? x + 1 : 0`, with once-only topic temporaries for general operands. The rejected line has no counterpart. Decided by the agent from principle 2 (mirror the pinned TC39 proposal and its reference parser), principle 8 (a syntax error can be relaxed later) and principle 4 (one parse per program), 2026-10-30. Reconcile Appendix A (beside the CatchExpression `?` early error), the 002 pipe examples and the snapshot README reconciliation list; keep upstream `spec.html` unchanged. Native evidence: `r31probe/pipe-cond.log` (both Babel versions; parenthesized and branch controls parse) and `r31probe/r31-counterparts.log` (`[1, 1, 5]` for x = 4); not VibeLang parser conformance.
    Status: applied in bb50c30ea831, landed in main f58798560fe7 (spec-fix-a, gate mq-10310743-2). Appendix A early error beside the catch one, snapshot receipt row; 002 unchanged.

    **Diagnostic-owner correction (Loop r3, detail 247).** The earlier “No `EK` code” sentence is superseded by accepted public VIP-34/detail 232: this adopted/reconciled pipe rejection uses `EK2301`. Syntax, precedence and admitted controls stay unchanged; detail 247 owns the catalog completion.

### Detail 239

**An explicit `throw` that can complete a plain `catch` handler is a lint warning.** (Opus r31 m56; VIP-5 amendments, details 39/62/71.) Detail 39 meaning stands: the throw is a JavaScript exception inside `Effect.succeed(h(e))`, so the result dies. Add one VIP-38 lint warning, `EK0511` (the first VIP-5 code after decided `EK0510`; the fixer confirms it is free on main), when a plain `catch` handler has an explicit `throw` that can complete the handler: not one caught inside the handler, and not one in a nested function. Quick fix: `catch effect (e) => { ... }`, which turns the throw into a typed failure; the fix is offered, never applied by formatting. Tracked throwing calls keep `EK0403` (detail 39); implicit exceptions stay silent defects. A warning-only run exits zero (detail 71), and `vibe.severities` configures the code. This mirrors detail 62 (`EK0508`): a plain handler written as an effect handler gets one warning and the same quick fix. No program changes meaning or stops compiling.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    ```vibe
    effect function load(id: string) {
      const user = fetchUser(id) catch (e) => { throw new Wrapped(e) } // EK0511 warning: dies, not a typed failure
      return try user
    }
    effect function typed(id: string) {
      return try (fetchUser(id) catch effect (e) => { throw new Wrapped(e) }) // fails with Wrapped
    }
    ```
    Effect TS: `load` is `Effect.gen(function* () { const user = Effect.catch(fetchUser(id), (e) => Effect.succeed((() => { throw new Wrapped(e) })())); return yield* user })`, which gives `Die(Wrapped)`; `typed` is `Effect.gen(function* () { return yield* Effect.catch(fetchUser(id), (e) => Effect.gen(function* () { return yield* Effect.fail(new Wrapped(e)) })) })`, which gives `Fail(Wrapped)` (`r31probe/r31-counterparts.log`, Effect 4.1.0). Decided by the agent from principle 1 (a TypeScript reader expects a rethrow to stay typed, so the silent defect needs a visible signal), principle 4 (the same treatment as detail 62 for the same plain-handler mistake) and principle 8 (a warning changes no admitted program), 2026-10-30. Add the row to 002 `catch`, 007 lint list and Appendix B, with the example.
    Status: applied in 71f0479db9f0 (spec-fix-d; queued, not yet a main landing receipt). Published in 002, 007, Appendix B and VIP-5. The compiler has not registered EK0511: specAhead carries it for an implementation lane.

    **Immutable-main source publication (013cfa002833, 239).** Chapters 002/007, Appendix B and public VIP-5 publish `EK0511` for an explicit `throw` that can complete a plain `catch` handler, excluding internally caught throws and nested functions. The effect-handler fix, silent implicit defects and existing `EK0403` tracked-call check stay distinct. Source publication does not prove the compiler warning/quick-fix implementation. The full six-file diff was read; `source-013-publication.json` retains its hash and exact scope.

### Detail 240

**`is` bindings in `for` heads, concise arrow bodies and initializers use the pinned explainer homes.** (Opus r31 m59; VIP-7 pinned explainer "Bindings": "When used in the head of a `for()`, the usual binding scopes apply"; extends 004 nearest-block rule and details 109/191/214.) A `let` or `const` introduced by `is` gets this lexical home:
    - `for (init; test; update)`: a loop head scope that shadows outer names and does not leak. A binding from `init` behaves as a name declared by a `let`/`const` declaration in `init`, whether `init` is a declaration or an expression: a `let` binding is copied into each iteration environment by ECMAScript CreatePerIterationEnvironment, and a `const` binding stays in the loop scope. A binding from `test` or `update` is a fresh, uninitialized cell in every environment CreatePerIterationEnvironment creates, shared by the update, test and body that run in it and never copied forward, as detail 191 gives each `while` condition. So `for (; it.next() is { done: false, value: let v }; )` never re-initializes `v`.
    - `for…in`, `for…of`, `for await`, `for concurrent` and `for try`: a binding from the head expression (evaluated once, in detail 109 head environment) is copied into each iteration or item binding environment, as the explainer states; a skipped binding is copied uninitialized. A binding from a default inside the head declaration belongs to that iteration fresh binding environment.
    - A concise arrow body: the arrow body scope, where its block-body form would declare it.
    - A class field or static field initializer: that initializer own scope, as ECMAScript evaluates each initializer as a separate method-like body. A `static` block is a block.
    - Formal parameters keep detail 214 `EK0705`. An enum member initializer has no lexical home in ECMAScript or the explainer, so a binding there is `EK0705` too (principle 8; a later reconciliation can relax it).
    Bindings stay in TDZ until their pattern executes, and the detail-80 use-before-assignment check (Opus r31 m58) applies in every home.
    ```vibe
    function drain(it: Iterator<number>) {
      const out: (() => number)[] = []
      for (; it.next() is { done: false, value: let v }; ) out.push(() => v)
      return out.map(g => g())           // [1, 2, 3] for [1, 2, 3]: one fresh v per iteration
    }
    function countdown(src: { n: number }) {
      const seen: (() => number)[] = []
      for (src is { n: let n }; n > 0; n--) seen.push(() => n)
      return seen.map(g => g())          // [3, 2, 1] for n = 3: copied per iteration like let
    }
    enum E { A = (1 is let one) ? 1 : 0 } // EK0705: no lexical home
    ```
    Effect TS: `drain` is `for (;;) { const r = it.next(); if (!(typeof r === "object" && r !== null && r.done === false)) break; const v = r.value; out.push(() => v) }`; `countdown` is `for (let n = src.n; n > 0; n--) seen.push(() => n)` after the object test. `r31probe/r31-counterparts.log` gives `[1,2,3]` and `[3,2,1]` on Node 26. Decided by the agent from VIP-7 pinned explainer text (for-head scopes and for-of copies), principle 2 (ECMAScript per-iteration environments and field-initializer bodies), principle 4 (one loop-condition rule shared with detail 191) and principle 8 (`EK0705` where no home exists), 2026-10-30. Add the rule and the two loop examples to 004 `is` expressions and VIP-7 public amendment; the `EK0705` row names enum member initializers.
    Status: homes, TS2454/TS2448 rule and loop witnesses landed on main 003924407712 (commit 84be1db2b58b); remaining clauses (enum-member initializer EK0705, the EK0705 row, the VIP-7 clause, the guide for(;;) copies) queued in 350e37c7b3ef (spec-fix-c), not yet a main receipt.


    **Immutable-main source publication (773bddb1d57f, 240).** Chapter 004, Appendix B and public VIP-7 publish `EK0705` for `is` bindings in `enum` member initializers, completing the previously separate source-home clause in this slice. No compiler binding-scope check or guide-wide audit was run. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

### Detail 242

**An `effect` function or producer expression parses its own name with the parameters of its own body, as every ECMAScript function expression does; a declaration name takes the enclosing context.** (spec-fix-a `900-effect-expression-name`, found 2026-10-31 on main 4e088ab33903; VIP-17 amendment "exactly as `await`"; details 212/216; await-parity principle, Will 2026-10-30.) Appendix A gets two productions: `ReturnType = ":" Type`, the TypeScript return-type annotation parsed as TypeScript parses it (types take no Effect parameter), and `Name = BindingIdentifier` with these parameters. In an `EffectFunction` or `Producer` *expression*, `Name` takes the grammar parameters Appendix A gives that body, `[+Effect]` included (a Producer also `[+Yield]`): ECMAScript parses every expression name this way (`FunctionExpression` `[~Yield, ~Await]`, `GeneratorExpression` `[+Yield, ~Await]`, `AsyncFunctionExpression` `[~Yield, +Await]`, `AsyncGeneratorExpression` `[+Yield, +Await]`). So `fork` or `join` as the own name of an expression is `EK1702`, exactly as `(async function await() {})` is a SyntaxError (tsc 5.9.3 TS1359). In an `EffectFunction` or `Producer` *declaration* and in every `EffectFunctionOverload` signature, `Name` is `BindingIdentifier[?Yield, ?Await, ?Effect]`: the enclosing context decides, as `AsyncFunctionDeclaration : async function BindingIdentifier[?Yield, ?Await]`, so `export effect function fork() {}` is valid plain code at module top level and `EK1702` inside effect code, where the existing body rule already reserves the names. Method and class-member names are `PropertyName`/`ClassElementName`, which ECMAScript never reserves (`{ async await() {} }` is valid), so `effect join() {}` as a method stays valid; arrows have no name. Option B (the name always takes the enclosing context) differs from `await` with no stated reason and is rejected. The compiler reporting nothing for `effect function f() { const join = 1 }` either is a separate VIP-17 compiler gap.
    ```vibe
    export const f = effect function join() { return 1 }    // EK1702: the expression name is Effect code; rename it or declare it
    export const g = effect function* fork() { yield 1 }    // EK1702
    export effect function fork() { return 2 }              // valid: a declaration name takes the enclosing plain context
    effect function outer() { effect function join() { } }  // EK1702: the enclosing context is Effect code
    const o = { effect join() { return 3 } }                // valid: a method name is a PropertyName
    ```
    Effect TS: `(async function await() {})` is TS1359 in tsc 5.9.3 and the two `EK1702` expressions have no counterpart; the repaired `export const f = effect function joinOne() { return 1 }` is `export const f = function joinOne() { return Effect.succeed(1) }`, and `export effect function fork() { return 2 }` is `export function fork() { return Effect.succeed(2) }` (`fork` is an ordinary TypeScript identifier). ECMAScript module code reserves `await` everywhere, so the declaration case has no JavaScript module witness; VibeLang reserves `fork`/`join` only in Effect code (VIP-17), which is why its declaration form is observable. Decided by the agent from principle 2 (mirror the ECMAScript expression-name and declaration-name grammar), the await-parity principle (running an Effect is allowed, forbidden and ordered exactly where `await` is, and a rule that differs needs a stated reason; option B has none), the VIP-17 amendment (reserved exactly as `await`) and principle 8 (a reservation can be relaxed later, a permission cannot be withdrawn), 2026-10-31. spec-fix-a writes `Name`, `ReturnType` and the `[Effect]` section sentence with the test; keep upstream grammar unchanged.
    Status: applied in 61739af16372, landed in main ab92e0dad56f (spec-fix-a, gate mq-10310928-9; replaces rejected 20df9873bf7a). Name/ReturnType productions, [Effect]-section paragraph, VIP-17 amendment, test. The EK1702 row follows after queued spec-fix-b ca9f9516ee16 lands.

### Detail 243

**`EK1802` stays the VIP-18 retirement error for `await.all`, `await.race`, `await.any` and `await.allSettled`; an unsupported dotted `try` form such as `try.map x` takes `EK1803`.** (spec-fix-b `002-EK1802-double-allocation`, found 2026-10-31 on main 4e088ab33903; amends the detail 212 clause "Remaining syntax/check triggers" for `EK1802` only; VIP-18; VIP-34; the 900 diagnostic-reuse rules.) Main 4e088ab33903 registers `EK1802` in `retired_await_operations.go` (91b830c7759c, the VIP-18 implementation) with the message "{0} was removed by VIP-18: write try.all, try.race, try.any or try.allSettled over an array of Effects, or try all({ … }, { concurrency: "unbounded" }) for an object; vibelang --fix rewrites it", a `--fix` codemod registered per code (`tsFormFixCodes`, `vipMigrationFixCodes`) and user-doc references. Detail 212 allocated the then-free `EK1802` to `try.map x` on paper only, and spec-fix-b left `try.map x` without a code. A shipped code with a codemod and docs keeps its meaning: the catalog allocation is unapplied and moves, while moving the landed code would break `vibe.severities` entries, the fix registry and the docs. One code never carries two repairs: `--fix` is registered per code, so a merged `EK1802` would promise a rewrite that `try.map x` does not have, and VIP-34 wants one message that says how to fix. Appendix B adds both rows under VIP-18: `EK1802`, error, a retired `await` execution operation, quick fix: the VIP-18 rewrite to the `try` operation; `EK1803`, error, an unsupported dotted `try` execution form such as `try.map x` (`all`, `race`, `any` and `allSettled` are the only dotted forms), message: name the four operations and say to run the Effect with `try` and apply the function to the result; the fixer confirms `EK1803` is free on main. `EK1705`, `EK1706`, `EK1907` and `EK0510` of the same clause are unchanged (ca9f9516ee16 applies them). Unlike the `EK485x` migration warnings, `EK1802` is an error: the retired spelling has no meaning after VIP-18.
    ```vibe
    effect function run(xs: Effect<number>[], x: Effect<number>) {
      const a = await.all xs          // EK1802: removed by VIP-18; vibelang --fix rewrites it to try.all xs
      const b = try.all xs            // valid
      const c = try.map x             // EK1803: not a try operation; write double(try x)
      const d = double(try x)         // valid
      return [a, b, c, d]
    }
    ```
    Effect TS: `try.all xs` is `yield* Effect.all(xs)` and `double(try x)` is `double(yield* x)`; `await.all xs` has had no counterpart since VIP-18, and `try.map x` has none (Effect 4.1.0 maps with `Effect.map(x, double)` or `x.pipe(Effect.map(double))`, which VibeLang writes as `double(try x)` or `try Effect.map(x, double)`). Decided by the agent from principle 8 (a landed code with a codemod and docs is a permission already granted; the unapplied catalog allocation moves instead), VIP-34 (one message and one fix per code, quick fixes registered per code), detail 212 (its catalog clause, amended here for `EK1802` only) and principle 4 (the VIP-18 block keeps one code per rule, like `EK1801`), 2026-10-31. spec-fix-b applies the `EK1803` row and the `EK1802` row with the clause.


    Applied in f51f9f10ed1b (spec-fix-b, bookmark 41; queued on main 77510050781c, not a main receipt; replaces d7bdf74457b2): 002 rows and Appendix B rows for `EK1802` (retired `await` operations) and `EK1803` (`try.map x`), Appendix A note, `specAhead` gains 1803; replaces ca9f9516ee16.

    **Immutable-main source publication (773bddb1d57f, 243).** Chapter 002 and Appendix A/B publish `EK1802` for retired `await` execution operations and `EK1803` for unsupported dotted `try` operations, retaining the different fixes. This is the existing settled allocation, not a new code choice or CLI/codemod validation. Complete 60,380-character/60,428-byte nine-file design diff was read in four contiguous slices; `main-resumed-source.json` preserves its hash and scope.

### Detail 246

**A pipe continuation cannot split an unparenthesized arrow handler at its right edge; `EffectArrow` follows the pinned arrow covering restriction.** (Loop r3 Opus OPUS-3; carries r1 OPUS-1; accepted VIP-1/VIP-5/VIP-23; extends details 145/156/170/238.) In the reconciled pipe grammar, it is a syntax error for the input of a `PipeExpression` to end in an unparenthesized `ArrowHandler`: a `CatchExpression` whose handler is an `ArrowHandler` with an expression body (the `AssignmentExpression` alternative of `ConciseBody`), or a `PipeExpression` whose `PipeBody` recursively ends in one. That `|>` belongs to the arrow's concise body instead. Parentheses that close the handler or whole catch expression, a `NonArrowHandler`, and a block-bodied `ArrowHandler` end this propagation; do not inspect through those barriers. This removes the competing outer-pipe derivation rather than rejecting the uniquely greedy source program. Ordinary pipe chains still associate left, and the separate whole-body `PipeExpression` and conditional-test restrictions stay. This is a grammar reconciliation required by the already-published statement that an arrow body extends as far as an assignment expression, not a second evaluation mode for pipes.
    Wherever the pin's covering-production early-error list names `ArrowFunction`/`AsyncArrowFunction`, the reconciled list also names `EffectArrow`: a whole unparenthesized Effect arrow cannot be a pipe body. Parenthesized arrows retain the pinned topic rules, including lexical topic capture; do not invent a function boundary for `ContainsOuterTopic`. A nested pipe's own body continues to hide its own topic exactly as the pin says. The rejected forms use VIP-23's `EK2301` under the companion diagnostic allocation; an independent `catch`-outside-effect or native type error keeps its existing code.
    ```vibe
    effect function controls() {
      const x = succeed(5)
      const a = x |> % catch () => 0 |> % + 1     // 5: + 1 belongs to the handler
      const b = (x |> % catch () => 0) |> % + 1   // 6: parentheses close that handler
      return [a, b]
    }
    const bad = 1 |> effect () => % |> [%]        // EK2301: bare Effect arrow pipe body
    const good = 1 |> (effect () => %)             // parenthesized arrow; no implicit execution
    ```
    Effect TS: `controls` is `Effect.gen(function* () { const x = Effect.succeed(5); const a = yield* Effect.catch(x, () => Effect.succeed(0 + 1)); const t = yield* Effect.catch(x, () => Effect.succeed(0)); const b = t + 1; return [a, b] })`; `good` is a once-bound `const t = 1; const good = () => Effect.succeed(t)`. The rejected whole bare arrow has no admitted counterpart. Decided by the agent from principle 2 (native greedy arrow concise bodies and VIP-1's Effect/async correspondence), principle 4 (one recursive right-edge rule rather than witness-specific exceptions), the accepted VIP-5 concise-body rule and the pinned VIP-23 covering restrictions, 2026-10-31. Publish the reconciliation in 002, Appendix A and the snapshot README, keeping upstream `spec.html` unchanged. Required regressions/fuzz neighborhood: plain/Effect arrows, zero/one/many preceding pipe stages, success/failure operands, parenthesized/closed handlers, block versus concise arrows, nested pipes, topics captured by a parenthesized arrow, and the existing conditional/assignment/yield controls. Spec-quoted oracle: one derivation with the same once-only evaluation order and result as the explicit parenthesized greedy control. Native TypeScript 5.9.3/Effect 4.1.0 reference probes in `native-loop-r3/` give greedy 5 versus explicit-outer 6; this is not VibeLang parser/compiler conformance.

    **Block-arrow boundary clarification (existing246, 2026-10-31).** The right-edge predicate follows only an arrow whose `ConciseBody` takes the `AssignmentExpression` alternative. An arrow with a `{ FunctionBody }` alternative is already bounded by its closing brace and may be followed by an outer pipe; its plain/Effect kind makes no difference. This is distinct from an expression body containing a parenthesized object or an `effect { }` expression, which remains an expression body. Parenthesizing only the body expression does not parenthesize/close the handler. Keep the pinned whole-pipe-body covering ban on all bare `EffectArrow` forms, block-bodied arrows included; that is a separate check.
    ```vibe
    effect function closed() {
      const x = succeed(5)
      const a = x |> % catch () => { return 0 } |> % + 1        // 6: block closes the handler
      const b = x |> % catch effect () => { return 0 } |> % + 1 // 6: same boundary
      return [a, b]
    }
    ```
    Effect TS: each line is `const t = yield* Effect.catch(x, h); const value = t + 1`, with `h = () => { return Effect.succeed(0) }` for the plain handler or `h = () => Effect.gen(function* () { return 0 })` for the Effect handler. Native AST controls distinguish `Block` from expression arrow bodies, and native Effect success/failure controls give `[6,1,6,1]` (`native-loop-r3/arrow-block-boundary.log`). Decided by the agent from principle2 (native block versus expression arrow bodies), accepted VIP-5's TypeScript concise-body category, and principle4 (the reconciliation eliminates only a competing derivation), 2026-10-31. Adds no new numbered decision or broader arrow/pipe restriction. Regression/fuzz controls must vary block bodies, parenthesized expression bodies and whole parenthesized handlers independently. This is native counterpart/grammar reasoning, not a VibeLang compiler proof.

### Detail 247

**Complete owner-block diagnostics for already-rejected do, pipe, catch, arrow and declaration syntax.** (Loop r3 Opus OPUS-7 and r2 OPUS-3; Astra carryover do/pipe-code finding; accepted VIP-1/VIP-2/VIP-5/VIP-15/VIP-16/VIP-23/VIP-34; details 60/189/212/213/232.) Allocate the following error identities for otherwise-unassigned rejections only; these codes grant no new syntax and change no evaluation:
    - `EK0201`: VIP-2 adopted `do` grammar and proposal-specific early errors without a more specific assigned code, including a direct do-block `var` declaration and a prohibited final declaration. In a region where another more specific retained diagnostic owns the same source rejection, keep that diagnostic instead.
    - `EK0202`: a `break` or `continue` whose target lies outside its `effect { }` block. A jump to a target inside that block remains allowed, and an Effect block's `return` remains admitted. Preserve `EK2104` for its separately assigned nonproducer `yield` rejection.
    - `EK2301`: VIP-23 adopted/reconciled pipe grammar and early errors without a more specific assigned code: missing/unbound topic, forbidden covering production, a whole unparenthesized nested pipe body, the conditional-test reconciliation, and the catch-arrow right-edge reconciliation. Native modulo and native errors in pipe subexpressions do not become this code.
    - `EK0512`: remaining VIP-5 catch grammar/reconciliation rejections, including unparenthesized mixing with `??`/`||`/`&&` and a postfix member/call attached after a function-expression handler. Keep `EK0504`–`EK0511` for their specific triggers.
    - `EK0109`: a recognized Effect-arrow head violating its already-required head form, such as a typed or generic bare parameter that requires parentheses. Preserve contextual recognition, ordinary identifier uses and specific existing Effect diagnostics; do not classify every native arrow error as `EK0109`.
    - `EK1505`: a member of an ordinary schema field body that is not an admitted `Field`. This does not forbid the separately admitted methods of `schema error`, schema aliases or admitted computed fields.
    - `EK1606`: a malformed data variant production or a non-`Field` payload member, without replacing specific `EK1601`–`EK1605` errors.
    Detail 238's sentence “No `EK` code” is superseded by `EK2301`; its syntax rejection and repairs stand. Accepted public VIP-34/detail 232 cover adopted proposals as well as other custom grammar, so pipe has no exception from diagnostic ownership. Historical private parameter-default references to `EK0201` do not override the current `EK0102` allocation; retain the current parameter diagnostic. Legacy compiler `EK1006`/`EK1007` strings are not a public reallocation of the VIP-23 block: reconcile legacy emission under detail 189, preserving any separately retained specific published identity rather than printing two codes.
    ```vibe
    const badDo = do { let n = 1 }                    // EK0201: final declaration
    const badPipe = 1 |> 2                            // EK2301: no topic
    const badArrow = effect x: number!! => x          // EK0109: parenthesize the typed parameter
    schema BadSchema { m(): string }                 // EK1505
    data BadData { A(x: number) }                     // EK1606: use a field body
    const goodDo = do { let n = 1; n }
    const goodPipe = 1 |> % + 1
    const goodArrow = effect (x: number): number!! => x
    schema GoodSchema { n: number }
    data GoodData { A { n: number } }
    ```
    Effect TS: the repaired examples are `const goodDo = (() => { let n = 1; return n })()`, `const t = 1; const goodPipe = t + 1`, `const goodArrow = (x: number): Effect.Effect<number> => Effect.succeed(x)`, `const GoodSchema = Schema.Struct({ n: Schema.mutableKey(Schema.Number) }); type GoodSchema = typeof GoodSchema.Type`, and `type GoodData = Data.TaggedEnum<{ A: { readonly n: number } }>; const GoodData = Data.taggedEnum<GoodData>()`. Rejected forms have no accepted lowering; these simple no-jump counterparts are not universal IIFE recipes. Decided by the agent from accepted VIP-34/detail 232 (custom/adopted grammar owns its diagnostic), principle 2 (native source errors retain native identities), principle 4 (one fallback per owning rejection class), and principle 8 (label existing conservative rejections without admitting forms), 2026-10-31. Snapshot `loop-r3-code-availability.json` records all ten newly proposed catalog/ambient codes absent from the public catalog and three current definition/registry files at immutable main `a402928e343435e258b95a76dcabe080bf962c07`, and records historical claim matches; it is not a whole-history or compiler-emission proof. Publish owning chapters, Appendix A/B and accepted public amendments under detail 213 together. Add negative/repair/native-error controls for each row and spec-quoted fuzz mutations across nested contexts, parentheses, contextual identifiers and each member/variant category; assert the correct single primary owner code, retained specific codes, and independent native errors.


    **247 native-primary distinction for the intentional malformed-pipe fixture, decide-live, 2026-11-02.** Current immutable main41e2's `typescript/vibelang/lsp-fixture/src/malformed-pipe.vibe` starts `const e = |> 2`; its LSP smoke asserts that `TS1109` is present, not that this is the complete diagnostic set. The missing left primary reaches the ordinary `parsePrimaryExpression` fallback `parseIdentifierWithDiagnostic(Expression_expected)` at `parser.go:5950`. The lexer uses native `|` followed by `>`, and `parsePipeRest` receives an already-parsed left expression. Preserve that independent native expected-expression diagnostic under VIP-34/principle2. A parser helper alone does not make a custom rejection native; this case is the ordinary missing-primary error, not permission to relabel recognized pipe/topic/covering errors.

    ```vibe
    const missingLeft = |> 2   // retain the native missing-primary error TS1109
    const missingTopic = 1 |> 2 // recognized pipe's missing topic: EK2301
    const good = 1 |> % + 2
    ```

    The rejected forms have no accepted lowering. Effect TypeScript counterpart for the valid repair: `const topic = 1; const good = topic + 2`. No rule here requires all malformed operands to use one code or drops independent diagnostics during recovery.

    An intentional negative ESLint/ESTree corpus fixture may pin its actual expected failure under an exact source/compiler version, while still failing unexpected diagnostics and XPASS/stale expectations. Do not equate "intentionally invalid" with blanket success, use a filename-only exemption, or treat the LSP `.some(code === 1109)` assertion as an exact inventory of every fatal/syntax/checker diagnostic. This applies existing189/232/247 and principles2/4, adds no allocation or new language choice, and does not authorize protected-test edits. Source and assertion were inspected; no VibeLang parser/compiler/LSP/lint suite was run by this lane.

### Detail 248

**Runtime-only error, schema and data declarations have no ambient source form.** (Loop r3 Astra carryover ambient-declaration finding; VIP-13/VIP-15/VIP-16/VIP-34; follows detail 231's service rule.) Reject a recognized custom `error` or `schema error` declaration in an ambient source context with `EK1307`, an ordinary `schema` declaration with `EK1506`, and a `data` declaration with `EK1607`. Determine explicit/inherited ambientness as native TypeScript does: own `declare`, an enclosing ambient namespace/module/global region or declaration-file context wherever the custom form can otherwise occur. An `export`, a complete body or a bodyless error spelling does not create an ambient variant. Their accepted forms construct runtime error constructors, Schema values or tagged constructors, and no accepted VIP supplies an erased custom API for them.
    Preserve ordinary native TypeScript ambient class/const/type syntax, ordinary contextual-identifier uses, imported actual runtime declarations, generated `.d.ts` counterparts, admitted nonambient bodyless `error`/`schema error`, and all existing nonambient declaration forms. These errors take priority over the same declaration's missing-body recovery, as `EK0907` does; retain independent source errors and avoid duplicate root-cause diagnostics. This completes the existing conservative runtime-declaration rule, not a ban on native ambient types or a restriction on generated declarations.
    ```vibe
    declare error Missing                           // EK1307
    declare namespace Ambient {
      schema error Invalid { message: string }      // EK1307: inherited ambient context
      schema Row { n: number }                      // EK1506
      data Choice { A; B { n: number } }            // EK1607
    }
    error RuntimeMissing                            // existing bodyless runtime form
    schema RuntimeRow { n: number }                 // existing runtime schema
    data RuntimeChoice { A; B { n: number } }        // existing runtime constructors
    ```
    Effect TS: admitted runtime examples retain their usual `class RuntimeMissing extends Data.TaggedError("RuntimeMissing") {}`, `const RuntimeRow = Schema.Struct({ n: Schema.mutableKey(Schema.Number) })`, and `type RuntimeChoice = Data.TaggedEnum<{ A: {}; B: { readonly n: number } }>; const RuntimeChoice = Data.taggedEnum<RuntimeChoice>()` counterparts, with the ordinary associated type/declaration-output recipes. The rejected ambient custom forms have no runtime counterpart: a native `declare class` or `declare const` erases and cannot itself construct the promised value. Decided by the agent from the accepted runtime declaration counterparts and detail 231, principle 2 (TypeScript defines ambient context), principle 4 (one ambient rule for runtime-only custom declarations), and principle 8 (do not invent an unspecified ambient API), 2026-10-31. The companion current-catalog availability receipt covers `EK1307`/`EK1506`/`EK1607`. Publish 003/006, Appendix A/B and the accepted VIP amendments under detail 213. Required regressions and spec-quoted fuzz neighborhood: explicit/inherited ambientness, namespace/module/global/declaration-file nesting, export modifiers, full/missing/bodyless bodies, ordinary native ambient controls, generated declarations, contextual identifiers, primary diagnostic/recovery and independent native errors. No compiler acceptance/emission or migration-result claim is made here.

### Detail 249

**A catch-parameter initializer uses the same conservative `is`-binding gate as an unsettled formal-parameter home.** (Loop r3 Opus OPUS-8, with Astra's carried loop-update check; VIP-7; extends details 109/191/214/240/245.) Report existing `EK0705` when an `is` pattern in a plain catch clause's parameter initialization introduces a binding that would need the catch-parameter environment as its home. This includes nested binding defaults and evaluated computed binding keys. The catch parameter environment is distinct from the catch Block; neither the pinned scope rules nor accepted reconciliations supply this new binding home. Do not silently hoist it to the enclosing block, leak it into the catch Block or move initializer work into the body. Binding-free tests remain allowed. An explicit source `do` block, match arm or nested callable uses its own already-defined scope just as in detail 214, with unchanged evaluation order and exception behavior.
    Two source clarifications need no new scoping choice: an `is` binding in a `for concurrent(limit)` limit uses its nearest existing enclosing home, because the limit executes before the head environment exists; it is not copied from the head into items. In `for (init; test; update)`, a binding introduced by `test` or `update` is fresh and uninitialized in each environment described by detail 240; a read in `update` before that environment's first successful initialization is `TS2454` under detail 80, even if the previous iteration initialized its cell. Do not carry the old cell's definite-assignment fact forward.
    ```vibe
    function bad() {
      try { (null as any).code } catch ({ code = (1 is let c) }: any) {} // EK0705: no settled catch-parameter home
    }
    function good() {
      try { (null as any).code } catch ({ code = do { const ok = 1 is let c; [ok, c] } }: any) {}
    }
    effect function limitHome(xs: number[]) {
      for concurrent (1 is let n ? n : 1) (const x of xs) { use(x) }
      return n                                             // n belongs to this function block
    }
    function fresh(it: Iterator<number>) {
      for (; it.next() is { done: false, value: let v }; use(v)) {} // TS2454 in update: fresh cell before test
    }
    ```
    Effect TS: the repaired catch initializer's local no-jump block is `function good() { try { (null as any).code } catch ({ code = (() => { let c = 1; const ok = true; return [ok, c] })() }: any) {} }`, using a native `any` catch-parameter annotation solely to isolate this lexical-home witness. For `limitHome`, evaluate `let n = 1; const concurrency = n ? n : 1` in the containing generator before constructing the head/item work and `Effect.forEach`, then retain `n` there; the actual pattern test remains the pinned one. The fresh-read control `let v: number; use(v)` is native `TS2454`; do not lower the source loop by reusing one initialized variable. Decided by the agent from principle 8/detail 214 (reject a parameter home not yet specified), principle 2 (native catch-parameter/body separation and definite assignment), principle 4 (reuse the same gate and the already-decided loop/limit homes), and accepted VIP-7, 2026-10-31. Publish 004, Appendix B and public VIP-7 under detail 213. Add direct/nested/computed-key rejections, binding-free and explicit-block controls, nested callable boundaries, a limit binding visible after the loop, and update-read/closure/TDZ controls. Fuzz each parameter position/home boundary and for-head position against the quoted home rules. `native-loop-r3/` confirms the native fresh-read error; no VibeLang binding/compiler conformance is asserted.

### Detail 257

**Declaration emit elides a cyclic inferred type as `/*elided*/ any`, as TypeScript 5.9 and 7.0 do, instead of 7.1's `TS5088`.** (Will, 2026-10-31 20:05Z via the alchemy orchestrator, "decision 6" for migfix-alchemy alchemy-23; recorded here so the spec round writes it; chapter 000 "where a VIP is silent, its TypeScript counterpart applies"; chapter 007's description of the compiler.) Where TypeScript 7.1's new recursion rule (microsoft/TypeScript #64461, upstream `834e7862c031`) would report `TS5088` ("The inferred type of 'x' references a type with a cyclic structure") for an inferred declaration type, VibeLang prints `/*elided*/ any` at that position in declaration output and reports no error, for `.vibe` and `.ts` files alike. Will's reason: a repository's unchanged TypeScript compiles under VibeLang as it did under its own compiler. No upstream filing. The companion divergence alchemy-25 (#64553: inference from type arguments is cached as in 7.0.2) is a compiler bug fix with no spec text.

    ```vibe
    export const from = (value: string) => makeBuilder({ value })
    const makeBuilder = (state: { value: string }) => ({ state, named: (value: string) => makeBuilder({ value }) })
    // declaration output: named: (value: string) => /*elided*/ any   (TypeScript 7.0.2 byte for byte; 7.1 reports TS5088)
    ```

    Effect TS: the same two declarations are ordinary TypeScript; `tsc` 5.9 and 7.0 emit `/*elided*/ any`, and nothing in this code is an Effect.

    Spec placement: one sentence in chapter 007 where the compiler is described (the TypeScript 7.1 checker, with its named divergences), or beside chapter 000's silence rule, listing this as a deliberate divergence from 7.1 with the issue number. The compiler keeps 7.1's rule everywhere else. Fixers keep migfix-alchemy's witness as a declaration case and add a keyed fuzz generator over recursive builder shapes (object literal, arrow, method, class field) whose oracle is byte equality with TypeScript 7.0.2's emit. Decided by Will (not asked again); recorded by the agent from his stated reason and chapter 000's counterpart rule, 2026-10-31. Class A; no Will question.


    **257 ordinary declaration-oracle scope clarification, decide-live, 2026-11-01.** The Alchemy20:05Z decision6 text and257 are specifically about `TS5088`/cyclic inferred declaration elision; they do not require TypeScript7.0.2's entire declaration printer for unrelated source shapes. Keep the named7.0.2 counterpart for that approved divergence. Outside the named divergences, use a recorded stock native control matching the compiler's ordinary TypeScript7.1 lineage, and keep actual target/compiler/config/source identity explicit under291. The unrelated exported destructuring-const spelling is not authorized as another7.0.2 compatibility change by decision6.

    The target's actual shipped declaration gate remains separate: compare against complete original-source output with the required deterministic mode and actual chosen original compiler, preserving raw differences and emit outcomes. A same-source7.0.2-versus7.1 difference is not, by itself, migration causality; nor is naming that cause permission to ignore a real published-byte change. Rebuild/prove the appropriate complete baseline and keep257's explicit exception tests separate. If a producer such as `tsrs` does not support the required serial mode, establish a verified compatible official artifact/driver rather than silently substitute another major/minor emitter or claim an unverified parallel result. No source workaround, comparator normalization or fabricated success follows. This applies existing257/277/291/292 and principles2/8; no new language choice or Will question. The reported two Alchemy files and compiler outputs are owner receipts, not native7.1 executions by this lane.

### Detail 259

**Interim `EK9204` is not configurable, and its Appendix B row names every site the transitional compiler reports.** (oracle-appb and smithers-f2's two open questions in `fuzz-coverage/core-requests.md`; details 57, 60 and 189; chapter 007 "Severities"; principle 8.) `vibe.severities` admits VibeLang's own warning codes and the imported `EK38xx` codes (007; detail 57). An interim `EK92xx` code sits in the separately labelled compatibility inventory and is not one of the language's own rules (detail 189), so an entry for it is the same config error as any other code that may not be configured, `EK3006`, even though the compiler prints it as a warning; the oracle and the compiler already agree. A transitional code retires with its VIP, so a project setting keyed on it would vanish; refusing now can be relaxed later, a permission cannot be withdrawn. The row's trigger column documents the actual compiler revision (detail 189): the compiler reports `EK9204` both at an old Effect `try`/`catch` statement with no expected errors and at the `catch` keyword of a catch expression whose head cannot fail (`catch_expressions.go`, `deadCatchExpression`). The row lists both sites and, per site, the accepted-language successor: the statement site retires with VIP-5's removal of the `try` statement (`EK0503`); the expression site is a plain compatibility report with no normative successor, since a catch expression on an infallible head is valid Effect code (`Effect.catch` on `never` is a no-op) and VIP-5 defines no warning for it; it retires outright.

    ```vibe
    effect function run() {
      const n = try succeed(1)                 // valid: an infallible Effect is still run
      const m = succeed(2) catch (e) => 0      // valid; the transitional compiler also prints interim EK9204 here, and the row says so
      return n + m
    }
    ```

    ```json
    { "vibe": { "severities": { "EK9204": "off" } } }   // EK3006: an interim code cannot be configured
    ```

    Effect TS: `Effect.gen(function* () { const n = yield* Effect.succeed(1); const m = yield* Effect.catch(Effect.succeed(2), () => Effect.succeed(0)); return n + m })`.

    Fixers update the Appendix B interim table's `EK9204` row and the configuration oracle (`config:severity-interim-rejected` keyed case), and add a fuzz mutation over the eight interim codes in `vibe.severities` expecting `EK3006` for each. Decided by the agent from details 57 and 189, chapter 007's severities rule and principle 8, 2026-10-31. Class A; no Will question.

### Detail 272

**Migration setup never edits a test or a fixture; a test that bundles `.vibe` passes unchanged or its modules stay `.ts`.** (spec agent, 2026-11-01T03:23:20Z, superseding the test-file part of decide-live's 2026-11-01T01:56:27Z entry "embedded esbuild configuration is tool wiring" in `inbox/migrate-smithers.md`; source rule: every migration's definition of done, "no test was edited to pass", and the opencode owner's 2026-11-01T02:25Z decision on opencode-32.) Setup may wire `vibelang()` and the emitted-JS export condition (opencode-32 option B) into a repository's own sources, build scripts and configuration files outside tests. It never rewrites a test file, a test fixture, or a configuration embedded in either (an esbuild/`Bun.build`/Vite config inside a test, a `bun build` CLI call a test spawns). A test that bundles or loads `.vibe` must pass unchanged, through the emitted JS behind the export condition (the package's `exports` resolve the condition the test's own tool already uses, or the default condition points at emitted JS); where it cannot, the plan reports each module that test reaches with the cause (opencode-32's option C) and those modules stay `.ts`. Precedent: a migration's tests are its oracle, so editing one to pass destroys the evidence that the migration preserved behavior.

    **Recovered formatter-proof notes belonging to272 (decide-live, 2026-11-02):** the throw-expression rewrite removed these unrelated entries because they had been appended under284. Restore their exact owner-authored text here; no permission or proof requirement is changed. Source: fully read `watch-critical-20261102T131704460735Z-3739087.diff`, prior snapshot preserved.
    - *Sixth addendum to detail 272 (effectscript-11's decision, not Will's; recorded 2026-11-01T09:26:54Z): formatter-only changes.* A test already written in VibeLang may take formatter-only changes when the verifier proves the parsed AST is identical with trivia ignored, and the PR lists them under their own heading. It covers dprint's output only, nothing done by hand.
    - *Tightening of the sixth addendum (spec agent, 2026-11-01T09:27:46Z, from the smithers agent's finding):* the proof is the parsed AST with locations stripped AND the token stream, equal apart from whitespace, comments and trailing commas. ESTree has no node for redundant parentheses, so an AST comparison alone passes added parens. A file that does not parse fails the proof. This narrows the allowance and widens nothing.
    - *Second tightening of the sixth addendum (effectscript-11, recorded 2026-11-01T09:28:08Z):* comments are compared, not ignored. They stay in the token stream in position among the code tokens, with only their internal whitespace normalized, so the stream is equal apart from whitespace and trailing commas. A dropped or moved `// @ts-expect-error` or `// @ts-ignore` changes what a test checks and fails the proof. This replaces "comments" in the first tightening.
    - *Third tightening note on the sixth addendum (effectscript-11's decision, recorded 2026-11-01T09:29:09Z):* the token stream may also differ in a statement-terminating `;` that dprint removed or added, with the AST half still required. So only whitespace, trailing commas and statement-terminating semicolons may differ. A `;` in a `for` head, and an empty statement, still count.

### Detail 280

**The compiler never overwrites a sidecar it did not write.** (spec agent, 2026-11-01, common sense and precedent, asked by effectscript-11 from main-red FuzzCommandLine/seed#7; amends VIP-27 and reverses nothing. VIP-27 and the spec were silent; `WriteFile` in `typescript/tsc/internal/compiler/sidecars.go` overwrites unconditionally, a silent wrong result.) Precedent: `tsc`'s `TS5055` "Cannot write file ... because it would overwrite input file", and the `// Code generated ... DO NOT EDIT.` marker convention.
    - Every emitted `x.d.vibe.ts` starts with the comment `// Generated by vibelang from x.vibe. Do not edit.` (before any `/// <reference>`, which a comment may precede). A package build's ordinary `.d.ts` files do not carry it, so public declarations stay byte-identical (VIP-27).
    - Before writing: no file there, or the existing file has the marker, or its content equals the new output ignoring the marker, means write. Otherwise the compile reports an error (allocate a code by the registry and Appendix B rules, claim it) naming the file: "x.d.vibe.ts is not generated by vibelang and would be overwritten"; the file is left untouched and the rest of emit proceeds. Its quick fix deletes the file; the message says to move hand-written declarations to `x.d.ts`-style TypeScript or a `.ts` module. The equality clause means sidecars generated before the marker existed upgrade without an error unless they are stale, and a stale one takes one delete.
    - The check runs wherever sidecars are written: `vibelang`, `--watch`, the LSP, the bundler plugins, and in the directory of detail 268.
    - Tests: a hand-written sidecar is reported and unchanged on disk; a marked sidecar and an unmarked identical one are rewritten without a diagnostic; a marked sidecar with edits is regenerated. Fuzz oracle (`FuzzCommandLine` neighbourhood): for random pre-existing file contents at the sidecar path, the compiler either leaves the bytes unchanged and reports the code, or the old file had the marker or equal content.
    - **Rework of detail 280 (spec agent, 2026-11-01, after effectscript-11's review; replaces the error rule above, the marker stays).** The error had an upgrade hole: every sidecar written by 0.0.10 has no marker, so the first compile after any source or output change would fail, for normal users and all five migrated repos, and a hash manifest cannot help because old files are not in it. New rule: no compile fails and no upgrade needs action. Before writing `x.d.vibe.ts`: no file, a marked file, or an unmarked file equal to the new output ignoring the marker means write. An unmarked file that differs is moved, bytes intact, to `.vibe/sidecar-backups/<path mirrored from the project root>`, the generated file is written with its marker, and the compile reports one warning per run, not per file (allocate a warning code by the registry and Appendix B rules): "vibelang moved N unmarked .d.vibe.ts files to .vibe/sidecar-backups/ and regenerated them. Sidecars are generated; nothing is needed unless you wrote one by hand, in which case move it to a `.ts` module." Each file moves at most once, because the regenerated file has the marker. So a 0.0.10 sidecar upgrades silently apart from that one line, a hand-written file is preserved and reported, never destroyed, and later hand-edits of a marked file are regenerated, as the marker states. There is no error and no quick fix. The tests and fuzz oracle change accordingly: for random pre-existing contents, the compile succeeds, the sidecar is the generated output, and any unmarked differing bytes exist unchanged under `.vibe/sidecar-backups/`.
    - *Conditions on the rework (effectscript-11, Will's proxy, released it 2026-11-01T06:53:38Z; nothing that compiles today fails, so no ask to Will).* Each has a test. (1) `.vibe/sidecar-backups/` never joins a program: `tsc`, the LSP and globs exclude it, and the migrate flow's gitignore entry covers it, so no backup is compiled or picked up by a test selector. (2) A backup never overwrites an earlier backup: a colliding name takes a numeric suffix, so a second collision cannot destroy the first hand-written file. (3) Fuzz oracle: for any starting state of the sidecar path and the backup directory, no bytes are ever lost, and the compile result matches a clean compile.
    - *Note on detail 245 (spec agent, 2026-11-01T06:53:46Z):* effectscript-11 confirmed VIP-7's pinned text is the authority, so no ask to Will. The `TS2451` message points at the rename quick fix, and the release notes list the change as a behaviour change.

### Detail 284

**DECIDED: throw expressions follow the TC39 proposal exactly.** Will, verbatim (2026-11-02, `loop/WILL-ANSWERS.md`): "Refer to tc39 spec for answer". VIP-40 vendors `tc39/proposal-throw-expressions` commit `78b887751db4e380870a0a6bfc47319c50aa1404` and adopts its grammar, precedence and parenthesis requirements. General throw expressions remain supported. The retirement recommendation and its codemod are cancelled, including earlier references in details 140, 189 and 232; lane class1-legacy must retain them. Where a throw is allowed at all remains the 2026-10-31 no-throw ruling (VIP-4 amendment, EK0401), enforced by lane nothrow-impl. Grammar adoption grants no new permission for a plain function or eager parameter initializer to throw.

    A scoped example follows251's existing async rejection rule. Plain-function throws remain forbidden; Effect-code throw keeps VIP-4's typed-failure meaning:

    ```vibe
    async function requireValue(x: number | null | undefined) {
      return x ?? throw new Error("missing")
    }
    ```

    Effect TypeScript counterpart: `async function requireValue(x: number | null | undefined) { const value = x; if (value !== null && value !== undefined) return value; throw new Error("missing") }`. Both evaluate `x` once and reject the Promise with a newly constructed Error only for the nullish branch. This illustrates the recorded proposal adoption; the exact pinned grammar/VIP and compiler proof belong to `vip-throw-expr`, not a native TypeScript grammar-acceptance claim by this lane.

### Detail 291

**A tool cache for type-directed Vibe compilation must preserve fresh-compilation behavior across its actual inputs.** (The migfix-t3code-2 adapter receipt for `7de09fe83e27`, 2026-11-01; existing tooling fidelity, details272/277/283; principles1/2/4/8.) Where a tool consumes project-emitted JavaScript, a cache entry is reusable only while the inputs that can affect that result are unchanged. Account for the actual consumed source and relevant imported declarations/dependencies, resolved compiler configuration including inherited options, compiler/runtime/tool versions, and project identity. Equivalent safe native invalidation, recompilation or non-reuse is acceptable; this is a correctness contract, not a prescribed hashing API. Preserve diagnostics and source maps as well as JavaScript.

    A cache keyed solely by the current module's source is insufficient when other inputs affect its output. A documented manual `--reset-cache` is an interim workaround, not evidence of correct incremental/watch behavior. Do not assume CI is unaffected without checking whether its caches persist or are restored. A clean-cache integration milestone can be reported as such; it does not complete watch/cache integration. Reuse of another project's checker or compilation requires matching provenance and inputs, not just the same filename or source text. Bounded prewarming and performance tuning are ordinary engineering, not a question for Will.

    ```vibe
    export const selected = (item: { value?: number }): number => item.value ?? 0
    ```

    Effect TypeScript counterpart: this example is already ordinary TypeScript. Changing a consumed target from `ES2018` to `ES2022` can change its nullish-coalescing output without changing the module text. This illustrates the input dependency; this lane has not independently reproduced stale Metro output. For the reported type-directed adapter, the owner must also test an imported contract change that actually changes its emit/diagnostics and compare the cached/watch result with a fresh compile. Relevant inputs are those the compiler/tool really uses, not every unrelated file.

    Required regression and property coverage compares fresh versus reused compilation after same-source configuration changes, consumed dependency/declaration changes, invalid-to-valid and valid-to-invalid edits, project switches, and relevant version changes; include JavaScript, diagnostics and source-map locations. Keep unchanged-input reuse and already-emitted JavaScript handoff controls. Do not weaken protected target tests to obtain these controls: detail272's exact exceptions remain in force, and tool-owned regression/property tests can exercise the product adapter directly. The separately reported Mobile graph resolver still needs checked-edge fidelity; matching selected filenames does not authorize an extra target-test expression edit.

    Decided by the agent from principle1 (ordinary tool/watch behavior), principle2 (TypeScript project inputs), principle4 (one fresh-versus-cached correctness contract) and principle8 (do not certify unproved reuse), 2026-11-01, under Will's 2026-10-29 delegation. Class A, implementation/tooling fidelity; no new language syntax, public API choice or Will question. Existing implementation ownership remains with migfix-t3code-2 and the target drive. The owner's reported adapter tests are attributed evidence, not execution by this lane or proof that this remaining cache requirement has passed.



    **291 mobile graph disposition, decide-live, 2026-11-02.** The158-module Mobile cohort is not awaiting another Will decision under the current scope. Keep the affected sources TypeScript unless an already permitted product route preserves every checked native source/edge and passes the unchanged graph gate. The allowed extension-selector/sidecar-exclusion edit under272/278 does not authorize changing the protected resolver, transform, assertions or thresholds. The concrete two-module witness selects the same two filenames but loses its edge because the test appends only native TypeScript platform suffixes to an explicit `.vibe` specifier; equal node counts are not equal graph coverage. Do not hide that lost edge with an empty graph, skipped source or artificial mirror.

    This is a project-delivery boundary, not a ban on valid VibeLang imports or a new module-resolution rule. Compiler acceptance and React/Metro adapter support alone do not prove this repository graph check. Existing separately approved native-companion/selector routes remain available only with their actual source/edge preservation proof. A later request for a broader protected-test exception would be a separate authorization choice; no such exception is required to follow the already-decided conservative route now, and no repeated inventory/confirmation question is sent to Will. This records existing291/272/278, principle2 (the actual native graph) and principle8 (retain native source until equivalence), not a new numbered decision or test-edit permission.

### Detail 292

**A missing validation outcome is unverified; a later stage cannot inherit an earlier stage's successful exit.** (Smithers admission candidate `1416d7799276` and Foldkit110; principles1/2/8 and Will's observability instruction.) An authoritative check records the actual command outcome for that stage and its selected inputs. Diagnostic text does not establish that a compiler completed. Missing, interrupted, stale or legacy outcomes cannot become successful by copying another stage's exit code or predicting one from diagnostic categories. Recover independently recorded matching evidence, or rerun the required check and capture it before admission, verification or recording. Complete matching receipts need no unrelated rerun.

    Preserve both checks: actual process-outcome regression and newly introduced diagnostics. VibeLang can print a configured Effect diagnostic as an error while its documented compiler exit policy returns zero. Two actual zero exits with unchanged diagnostics must not become a synthetic `0 -> 2` regression. A genuine nonzero exit, signal, spawn failure or deadline interruption must not disappear because it prints no new diagnostic. Retain failed/incomplete stages, status/signal/cause and bounded output. Existing explicitly approved baseline failures still require matching cause and coverage evidence; an absent outcome is not that evidence. This changes no severity or compiler exit policy.

    ```vibe
    export const answer = 42
    ```

    Effect TypeScript counterpart: the identical ordinary TypeScript module. Its valid source does not prove that a particular compiler process completed. Admission needs291's source/project/options/tool identity and the actual completed outcome; a previous compiler's result is not the setup compiler's result.

    Full source inspection of `1416d7799276` confirms its useful fresh-path fix records setup's exit, but `exitReceipt?.code ?? before_.code` still substitutes the earlier code for an unknown legacy outcome. Its added property expects an absent after-status to be accepted when diagnostics are unchanged. That assertion needs correction: the same diagnostic arrays cannot distinguish an unrecorded successful compile from an unrecorded failed one. Legacy recovery must collect evidence rather than certify the unknown branch. Preserve the fresh-path fix; this selects no new public package result schema.

    Regression/property coverage varies diagnostic category independently of actual status: valid zero exits with warnings/nonfatal Effect diagnostics; nonzero exits with identical, empty or unparseable diagnostics; signals/spawn errors/timeouts; absent/null/partial legacy metadata; restart/recovery; selected-file versus whole-project errors; and input/tool changes invalidating receipts. Recapturing an actual unchanged zero result repairs the legacy case; failed outcomes remain refused. Foldkit's actual child exit2/SIGTERM controls and a later real compiler SIGQUIT all left the public wrapper reporting success; these are attributed owner receipts. This lane read the candidate and property but ran no compiler/tooling test. Existing owners retain their implementation claims.

    Decided by the agent from principle1 (a successful check means completed work), principle2 (process outcomes and diagnostics are separate observations), principle8 (reject unproved validation) and Will's observability rule, 2026-11-01, under his 2026-10-29 delegation. Class A; no new language permission, compatibility waiver or Will question.



    **292 recognized non-test failure clarification, decide-live, 2026-11-01.** A completed process can fail with no failed test-case entry: a coverage threshold or Bun's unhandled errors between tests is still a real failed outcome when the tool's actual receipt establishes it. Preserve the nonzero status and record the recognized independent failure; do not call it success or fabricate an absent process result. An unexplained exit, stale report or missing command outcome remains unverified under292.

    Where the target's explicit baseline policy compares known failures, a generic label alone is insufficient equality evidence. Retain coverage metric/threshold and selected-scope evidence, or the actual between-test error causes/counts, so a newly worse or different failure cannot disappear behind the same synthetic name. Preserve both main and preceding-commit comparisons where required, report the inherited failure honestly and keep missing/incomplete coverage visible. This is the existing actual-outcome/provenance/cause rule applied to the two parser requests, not an extra permission to accept unexecuted tests or to weaken a coverage threshold. Tool-owned regression/property controls should include recognized failure, unexplained nonzero exit, changed cause/metric, stale structured output and zero-test/incomplete-run negatives. No new language choice or Will question.

    **Emit outcomes and export routing (opencode-55, decide-live, 2026-11-01).** Prefer the package's valid native production-build project for an emission-only stage, with its actual source graph and configuration provenance; keep the original typecheck/test projects and checks unchanged. A test-inclusive project that pulls another package's fixture outside `rootDir` is not made valid by erasing `TS6059`, loosening an unrelated original check or changing its recorded exit. Preserve inherited-option bases when selecting/preparing the emit context.

    TypeScript can write files while returning nonzero. Some emitted files therefore prove neither successful completion nor a complete fresh package graph. Export routing must name actual current outputs from the required owned-source graph, with matching input/tool/options provenance and complete transitive resolution. Existing files or an output count alone do not prove this. If an implementation uses artifacts from a nonzero emit, retain that failed stage and independently establish all required artifact/admission evidence under details 291/292 and any explicitly approved baseline policy; never convert `2` to `0` or infer success from outputs. Otherwise leave that route unchanged or retain the affected native closure until the valid build and original gates pass. This rules out blind routing on every nonzero result without banning native TypeScript's ordinary emit behavior.

    Decided by the agent from principles 2 and 8, native project/emit behavior and details 272/277/291/292, 2026-11-01. This is an internal project-context/artifact-proof choice, not a new language or package API. Owners need minimized Opencode corpus, old-fail/new-pass and property controls for clean emit, unrelated versus owned diagnostics, stale/missing/partial outputs, signals/timeouts, config inheritance, package graphs and truthful statuses. No candidate emitter or target test was executed by this lane.


    **Explicit Foldkit-95/46 known-flake policy (Foldkit agent transmits Will-proxy option A, source labelled 18:30Z, observed 2026-11-01).** A complete otherwise-valid run whose only failures are the already-identified same-task trigger-click open assertions for Listbox, Menu and modal Popover may report a qualified `PASS` with those failures named in the suite line. Keep original tests, assertions and budgets unchanged and perform no retry. Every other failure stays red, including another test in the same `triggerClick.test.ts` files. Resolve the exact fully qualified test identities from the existing witnesses; a filename-wide or “click” substring allowance is not this policy. An ambiguous identity, missing/incomplete report, independent process/signal/coverage failure or unhandled error cannot qualify as “only these failures.”

    Preserve the actual failed command outcome, names, counts and receipts separately from the explicitly authorized aggregate classification. This exception does not turn an observed nonzero process exit into zero or erase historical failures. It does not include the distinct Vite five-second prerender timeout, optimizer cleanup/`ENOTEMPTY` failures or unrelated Menu tests. The earlier toolchain-regression classification of 95 is withdrawn by its owner after the old compiler reproduces the assertion and emits identical JavaScript; no compiler regression or bisect is inferred.

    This records the transmitted explicit policy, not an unobserved direct Will answer or a general flake exemption. It settles that owner's race-handling question and does not answer `throw-expressions` or `legacy-forms`. Classifier regression/property coverage must vary exact allowed test identities, near names/same-file other tests, mixed failures, missing reports and raw-status retention, with no retries or test edits. Detail 292's truthful evidence rule remains in force. No classifier code or target test was changed by this lane.

### Detail 295

**The native-match advisory family explicitly includes supported direct `Option.match`, retaining `EK4839` through a narrow public amendment.** (RC-8, scoped compiler pass29; Will's idiomatic-Vibe warning/`--fix` principle P7 in `core-decisions.md`; accepted VIP-7/VIP-34, details 60/124/213 and principles 1, 3, 4 and 8.) A supported identity-resolved Effect `Option.match(subject, handlers)` is another native-`match` style advisory, not a ban or runtime operation. Retain `EK4839` for this expressly recorded family extension. This amends the previously published Match-chain-only trigger; it does not pretend that old wording already included Option or authorize unrelated new rules to reuse unchanged-rule codes.

    Publish the Option trigger and accurate Option-specific message alongside the Match-chain trigger in VIP-7/VIP-34's advisory amendment, chapter 007 and Appendix B. Name `Option.match` rather than the separate Effect `Match` module. Keep the existing default warning, configurable `vibe.severities` and CLI/emit policy. Document the observable CI consequence of promoting `EK4839` to error and add the release-note line. The unchanged-rule exception in details 60/124 remains general outside this explicit family amendment.

    The conservative direct form uses the resolved Effect Option API and two arguments, with existing optional/generic/module-hatch/generator guards. Named imports and namespace aliases resolve by symbol identity; an unrelated local called `Option` does not qualify. This adds no curried/dynamic forms or warnings in ordinary TypeScript files. Separate detection from safe repair: retain refusal reasons when meaning cannot be preserved rather than force conversion or change source context/function kind.

    ```vibe
    import { Option } from "effect"
    const value = Option.some(1)
    const result = match (value) {
      when Option.Some(let n): n;
      default: 0;
    }
    ```

    Effect TS:

    ```ts
    import { Option } from "effect"
    const value = Option.some(1)
    const result = Option.match(value, {
      onNone: () => 0,
      onSome: (n) => n
    })
    ```

    This pure-callback witness is not a general rewrite template. Preserve subject evaluation, handler construction/native property-read order, selected callback identity/invocation, discarded/chained results, contextual/public types and comments. Do not turn returned program data into a run, introduce unchecked assertions or publish a truncated handler type. Unsupported/ambiguous repairs remain refused with a reason. Existing Match-chain behavior is unchanged.

    Decided by the agent from Will's P7, principle 1 (idiomatic native counterpart), principle 3 (resolved library identity), principle 4 (one native-match advisory family) and principle 8 (conservative safe-fix boundaries), 2026-11-01 under his 2026-10-29 delegation. Class A; no new language syntax, runtime permission, public package API or Will question. Public delivery is required under detail 213; registry entries alone are not authority. Source inspection confirms the new path and guards; the reviewer supplies six Option runtime cases, declarations/order checks and old/new severity controls. This lane ran no Option compiler test. Owners need failing-old-inventory publication tests and keyed spec-quoted coverage for identities, boundaries, message/severity/emission, callbacks/data/coldness, comments, typing and refusal behavior.

### Detail 300

**OPEN for the spec agent: `EK1101`'s repair classification and its end-state parse.** (Round 14 Opus OPUS-2 at frozen `b48c60e5ee9a`, VIP-11:30, 900:965, 007:193; lane spec-fix-r14 under Will's 2026-11-02 fix-on-find instruction.) Compiler commit `8fb3cf285207` wrote VIP-11's 2026-11-01 amendment ("Decided by Will in this VIP"). Will's words in VIP-11 remove trailing blocks ("ok yea trailing blocks is fucking awful remove that"); its Implementation line names two repairs, `f(args, () => { … })` or `f(args, effect { … })`. spec-fix-r14 fixed what accepted sources settle: Appendix C now lists the amendment's three repairs as `EK1101`'s quick fix does, and a 2026-11-02 VIP-11 amendment, Appendix B's row state the trigger as a parse position (no TypeScript or VibeLang production admits the `{`), from "There is no trailing-block syntax" and Appendix A. `//:spec-lint` gained `denied-vip-repairs`.

    **Still undecided.** (1) The repair is chosen by "what the block compiled to" ("where it ran as a program", "where it ran as an Effect function"), which refers to old VibeLang's D188/D376/D382 semantics that no chapter or VIP states, and the third spelling `f(args, effect () => { … })` is not in the Implementation line Will's denial carries. Either state the choice from the callee's last parameter type (Effect → `effect { … }`, function returning an Effect → `effect () => { … }`, otherwise `() => { … }`) or record Will's approval of the third form. (2) "Once the examples and cases are converted, the parser stops reading trailing blocks" keys the parse of `f(x) { }`, and whether `TS1005` accompanies `EK1101`, to repository state; state the normative end state. (3) "A block after an Effect dual that `0.0.10` placed elsewhere keeps its own error and migration (D382)" names no code.

    **The compiler.** Unchanged by this lane; it reports `EK1101` at the `{` with the three-way quick fix.


    **300 disposition, decide-live: decided as detail 300, Class A, 2026-11-02.** VIP-11 already rejects trailing blocks and requires a preserving migration. Its three explicit argument forms express the existing legacy outcomes; writing an explicit `effect` callback to reproduce an old implicit Effect-function activation needs no new approval. New function kind still follows its written `effect` keyword under VIP-1, never a callee's expected type.

    **Repair classification.** Determine the actual old lowering and argument position from pinned legacy source/compiler/options. An Effect value becomes `effect { ... }`; a callback that the old lowering already made an Effect-function activation becomes `effect () => { ... }`; an ordinary callback becomes `() => { ... }`. Preserve formerly executed operations explicitly with `try` and actual return-as-data behavior under 203/274. A callee's resolved parameter can establish part of the historical case but is insufficient alone: an ordinary callback returning a held Effect must not gain an Effect activation. Preserve callback count, coldness, argument/receiver order, captures, error/defect channels and public declarations. If kind, placement or body preservation is ambiguous/unproved, keep the diagnostic and explain not-fixed under VIP-34/270; a candidate merely type-checking is insufficient.

    ```vibe
    Layer.effect(Users, effect { return implementation }) // old program argument
    test("loads", effect () => { return 1 })              // old implicit Effect callback
    twice(() => { return 2 })                            // old ordinary callback
    ```

    Effect TS counterparts: `Layer.effect(Users, Effect.gen(function* () { return implementation }))`, `test("loads", () => Effect.gen(function* () { return 1 }))`, and `twice(() => { return 2 })`. These are preserving results, not name-based recognizers for those callees.

    **Normative end-state parse.** No accepted trailing-block production exists, regardless of a project's example/test conversion progress. Use native TypeScript parse/statement boundaries where no adopted VibeLang production owns the brace. Report `EK1101` at the same-line unadmitted brace identified by VIP-11's parse-position rule. Recovery may retain historical structure for diagnosis/migration; that grants no executing form. Suppress redundant missing-separator `TS1005` only for the identical trailing rejection already owned by `EK1101`; retain independent native lexical/syntax/name/type/body errors. Genuine native blocks, methods/heritage, admitted `provide` and line-separated native statements retain their rules. “Once the examples and cases are converted” describes implementation scheduling, never a source-dependent grammar switch.

    **Versioned dual compatibility.** Historical D188 placed an Effect-dual block data-first if that form fit, otherwise applied it to a returned function if that fit, otherwise appended it. D376 removed type-directed placement; D382 retained its preserving migration. These historical texts are evidence of old behavior to migrate, not accepted new-language authority. Inspected transitional `dual_block_migration.go` retains an actual native call error (including `TS2345`/`TS2554`/`TS2769`) with its repair if the appended compatibility call is invalid, or `EK1023` if it still type-checks with changed meaning. That existing compatibility path runs first without a duplicate `EK1101` for the same site; label its pinned artifact as transitional under 189/194. The end-state trailing rejection is `EK1101`. The eventual explicit repair preserves the original data-first/curried position and actual program/callback kind, never a guessed last argument. `EK1023` is no new VIP-11 assignment and this grants no type-directed current call semantics.

    Decided by the agent from Will's actual VIP-11 denial/preserving-codemod requirement, accepted VIP-1/2/34, principle 3 (syntax governs new calls), principle 4 (one owning rejection), and principle 8 (refuse unproved migration), 2026-11-02 under the 2026-10-29 delegation. Correct the earlier amendment's attribution: the three-way/code/recovery details derive from his denial by the agent, not additional Will answers. Publish in VIP-11/007/900 under 213.

    Evidence read at immutable main `2519454b6513`: complete `trailing_blocks.go`/`dual_block_migration.go`, first 180/150 lines respectively of their tests, `8fb3cf285207` description/paths, and exact D188/D376/D382 historical paragraphs. No compiler/codemod/native runtime/fuzz execution here. Owners retain failing-main regression/property coverage of three outcomes, held-Effect callbacks, overload/shadow/alias variants, data-first/curried placement, evaluation/captures, comments/refusals, native valid-brace controls and duplicate-versus-independent diagnostics. Await-equivalent running placement is unchanged.


    **300 classification precision, same decision.** “Factory callback” describes the old compiler's established Effect activation, never every callback with an Effect-valued result. A genuinely plain callback that eagerly constructs/returns a program stays plain, including its call-time work. For example:

    ```vibe
    let calls = 0
    const callback = () => { calls += 1; return held }
    // Keep this ordinary callback if that was its actual old kind/phase.
    ```

    Effect TS counterpart is the identical plain callback; `effect () => { calls += 1; return held }` would defer the increment and add an activation/result layer, so it is not an automatic repair. Existing VIP-1, 203/274/277 and principle 3 settle this, without another number or Will question. Require native-versus-migrated callback invocation/run counters and success payloads for both held programs and newly constructed programs, with eager side effects and cold controls. This clarifies the preceding short classification; it grants no implicit kind inference or result-driven run.

### Detail 310

**Unsupported pre-VIP special forms retire through preserving migration; historical decisions are not language authority.** (Will's no-pre-VIP-relics standing ruling recorded in `loop/WILL-ANSWERS.md`, 2026-11-03, verbatim relayed by effectscript-11; its D152 application; existing213/274/277 and principles1/2/3/4/7/8.) The legacy Option/Stream receiver-method extension, such as `value.map(f)`, retires. For every pre-VIP VibeLang special form reported by `vibelang-forms -legacy` that no current accepted VIP adds or inherits, implement the preserving codemod to the VIP form or ordinary Effect TypeScript API, migrate the repos and corpus, then reject the retired form with a clear diagnostic and list the change in release notes. No new question asks Will to confirm this inventory.

    ```vibe
    import { Option, Stream } from "effect"
    export const optional = Option.map(Option.some(1), value => value + 1)
    export const mapped = Stream.map(Stream.make(1), value => value + 1)
    export effect function collect() {
      return try Stream.runCollect(mapped)
    }
    ```

    **Effect TS:**

    ```ts
    import { Effect, Option, Stream } from "effect"
    export const optional = Option.map(Option.some(1), value => value + 1)
    export const mapped = Stream.map(Stream.make(1), value => value + 1)
    export function collect() {
      return Effect.gen(function* () { return yield* Stream.runCollect(mapped) })
    }
    ```

    Classify the actual legacy operation by resolved identity and the admitted source form, not a member's spelling alone. Ordinary TypeScript methods, including array and user-defined `map`, remain ordinary calls; accepted VIP forms and inherited TypeScript/TC39 syntax are not retired merely because an old inventory labels them legacy. Reconcile a stale inventory with the current accepted source instead of inventing a new ban. The oracle supplies the census; current VIPs and this ruling supply authority. Do not revive retired D-numbers as normative rules or add a compatibility parser exception.

    Migration preserves receiver/argument evaluation, captures, call-versus-run phase, coldness, success/error/environment channels, public declarations and original assertion/coverage contracts. For genuine old source whose behavior cannot yet be preserved, apply existing274's explicit refusal/guard policy and retain a safe TypeScript boundary or prior qualified SDK; do not silently apply a lossy rewrite or call a failed baseline green. This is no general permission to edit protected target tests. Migrate corpus through the owning workflow, retaining minimized old-source migration/rejection witnesses and current positive controls rather than deleting coverage or weakening budgets. Record intended forms-table moves individually with the ruling as their reason.

    Remove pre-VIP decision text from normative chapters as directed; retain D-number references only as history and receipt provenance. The recorded actual Will quote establishes the no-relics principle; effectscript-11's explicit application closes the former external `legacy-forms` question2 about Option/Stream methods. This is an agent application of the recorded ruling, not an invented literal option selection by Will, a timed default, or a completed compiler/codemod rollout.

    Decided by the agent from Will's recorded first-principles/no-relics ruling and existing213/274/277, 2026-11-03 under the 2026-10-29 delegation. Class A; no new syntax, package API or Will question. Regression/property coverage must prove old-form migration and rejection, native counterparts, aliases/shadowing and same-spelling ordinary methods, phases/channels/declarations and retained corpus. This lane records policy only and ran no compiler, migration or product test for this ruling.
