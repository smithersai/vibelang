# Appendices

## Appendix A. Grammar

VibeLang's grammar is TypeScript's, plus four TC39 proposals and the productions below. This appendix is the only place a VibeLang production is written, and a `.vibex` file uses these productions unchanged, read with TypeScript's JSX language variant ([VIP-39](../vips/0039-vibex.md) adds no production); chapters show examples and link here by production name. Pattern matching is pinned to commit `ba73ffe42f30f0cf56ece28bebdc28f955f2a52e` with its reconciliations ([Pattern matching](004-match.md)). Do expressions are pinned to `tc39/proposal-do-expressions` commit `3ef6d463b8163cbf222846b40d17178cca36e9e1` and the Hack pipe operator to `tc39/proposal-pipeline-operator` commit `5ac4dfd624e68b649e6f947885bf5ef67bac19f4`, each repository's head on 2026-10-28 (UTC), vendored in [`vips/tc39-do-expressions/`](../vips/tc39-do-expressions/README.md) and [`vips/tc39-pipeline-operator/`](../vips/tc39-pipeline-operator/README.md). Names not defined here (`Block`, `Type`, `UnaryExpression`, `ConciseBody`, …) are TypeScript's or ECMAScript's. `"x"` is a token; `X?` is optional; `X*` repeats; `[no LineTerminator here]` and `[lookahead ∉ …]` are ECMAScript's restrictions.

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

These productions carry the enclosing `In`, `Yield`, `Await` and `Effect` grammar parameters consistently. Alongside the pinned covering-production restrictions on conditional, yield, assignment and arrow bodies, an `EffectArrow` included, reject a body whose whole unparenthesized expression is a `PipeExpression`. Thus an unparenthesized chain has its unique sequential left-associated derivation; a parenthesized nested pipe remains valid with a separate topic scope. This restriction tests the whole body, not every nested occurrence of a pipe.

The open-arrow restriction is defined once under [CatchExpression](#catchexpression). It distinguishes an expression body, which can absorb a following pipe, from a closed block body.

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

It is a Syntax Error if the input of a [PipeExpression](#pipeexpression) ends in an open arrow handler: a `CatchExpression` whose handler is an `ArrowHandler` with an expression body, or a `PipeExpression` whose `PipeBody` ends in one. The `|>` then belongs to the arrow's body, as `?` does above: `a catch () => b |> % + 1` is `a catch (() => (b |> % + 1))`, and `x |> % catch () => y |> % + 1` is `x |> (% catch (() => (y |> % + 1)))`. This removes a derivation, not a program. Parentheses around the handler or the whole `catch` expression, a `NonArrowHandler` and a block-bodied arrow close the handler, so a following `|>` pipes the recovered value.

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
                      | CatchHead "catch" BlockArrowHandler
```

<a id="catchhead"></a>

```text
CatchHead = ClosedCatchExpression | BitwiseORExpression
```

#### CatchHandler

```text
CatchHandler = ArrowHandler | BlockArrowHandler | NonArrowHandler   (always a function literal; VIP-5, amended 2026-10-29)
```

<a id="arrowhandler"></a>

```text
ArrowHandler = ArrowFunction | EffectArrow   (expression ConciseBody only; no AsyncArrowFunction: VIP-5, amended)
```

<a id="blockarrowhandler"></a>

```text
BlockArrowHandler = ArrowFunction | EffectArrow   (block ConciseBody only; no AsyncArrowFunction: VIP-5, amended)
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

The braces hold a function body, as `(effect () => { … })()` does: `return` ends the block's Effect with a value, and `yield` is `EK2104`, and a `break` or `continue` whose target is outside the block is `EK0202`. So `const p = effect { return 1 }` parses at module top level.

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
                   | ServiceStart TypeParameters? ":" Type "{" (ServiceMember Separator)* "}"   (only KeyMember and DefaultMember are admitted; other members parse for EK0902)
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
ArmBody = [lookahead ≠ "throw"] Expression | "throw" Expression
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

#### ModuleDeclaration

```text
ModuleDeclaration = "module" [no LineTerminator here] BindingIdentifier "{" ModuleBody? "}"
```

#### ModuleSpecifier

```text
ModuleSpecifier = StringLiteral | IdentifierReference
```

#### ImportDeclaration

```text
ImportDeclaration = an ordinary TypeScript import declaration using ModuleSpecifier
```

VIP-40: TC39's module declaration, restricted to a top-level statement of a `.vibe` or `.vibex` file. `ModuleBody` is TypeScript. An identifier `ModuleSpecifier` appears in VibeLang code of the same file only. `module` stays an identifier everywhere else.

### Notes on the productions

**Do snapshot static predicates.** For `EndsInIterationOrBareIfOrDeclaration`, `CaseBlock : { }` returns `false` for either value of `isLast` and any `labelSet`, including when the switch is nonfinal. Every `ForTry` and `ForConcurrent` production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`. The loop statement itself has `IsEmpty` and `IsBreak` equal to `false`. Thus nonfinal loop bodies are still visited, and a final added loop is rejected like a final native loop. Ordinary switch completion and loop jump restrictions stay unchanged. The [snapshot receipt](../vips/tc39-do-expressions/README.md#static-predicate-reconciliations) records these reconciliations without changing the upstream draft; [Running Effects](002-running.md#do-expressions) gives the completion witnesses.

**Pipe snapshot reconciliations.** The missing-topic early error checks the `AssignmentExpression` child with `ContainsOuterTopic`; the `PipeBody` boundary still returns `false`. Evaluation uses the actual `ShortCircuitExpression` input once, with `GetValue`, rather than the stale `ConditionalExpression` reference. `GetPrimaryTopicValue` reads `topicEnv.[[TopicValues]]`, not the unbound `envRec`. Binary XOR `^` and XOR assignment `^=` remain ordinary TypeScript operators despite the duplicated `%` in the token table. The [snapshot receipt](../vips/tc39-pipeline-operator/README.md) records these corrections without changing the upstream HTML; [Running Effects](002-running.md#the-pipe-operator) gives the examples.

**`catch`.** [CatchExpression](#catchexpression) sits in ECMAScript's precedence chain beside `CoalesceExpression`, and its head mirrors `CoalesceExpressionHead`: it binds like `??`, is left-associative, and can't be mixed with `??`, `||` or `&&` without parentheses, for the same structural reason `a ?? b || c` is a syntax error. The handler is a plain or `effect` arrow or function expression, possibly parenthesized, so its kind is decided by its syntax alone; any other handler is `EK0509` ([Running Effects](002-running.md#catch)). An unparenthesized expression-bodied arrow handler ends the chain: its `ConciseBody` is the longest `AssignmentExpression`, as in an ECMAScript arrow, so a later `catch` belongs to the body. Any other handler is a closed expression, after which only another `catch` or a lower-precedence operator can follow.

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


### ThrowExpression

<a id="throwexpressioninvalidpunctuator"></a>

[VIP-41](../vips/0041-throw-expressions.md) imports the [TC39 specification](../vips/tc39-throw-expressions/spec.emu) at commit `78b887751db4e380870a0a6bfc47319c50aa1404`. The following are its productions, with ECMAScript's other unary alternatives retained.

```text
UnaryExpression[Yield, Await] =
  "throw" UnaryExpression[?Yield, ?Await] [lookahead ∉ ThrowExpressionInvalidPunctuator]
ThrowExpressionInvalidPunctuator = "," | "<" | ">" | "<=" | ">="
  | "==" | "!=" | "===" | "!==" | "+" | "-" | "*" | "/" | "%" | "**"
  | "<<" | ">>" | ">>>" | "&" | "|" | "^" | "&&" | "||" | "??"
  | "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "<<=" | ">>=" | ">>>="
  | "&=" | "|=" | "^=" | "&&=" | "||=" | "??=" | "?"
ExpressionStatement[Yield, Await] =
  [lookahead ∉ { "{", "function", "async" [no LineTerminator here] "function",
                 "class", "let [", "throw" }] Expression[+In, ?Yield, ?Await] ";"
```

The operand and parent positions follow `UnaryExpression`; `throw` in statement position is `ThrowStatement`. The expression production has no no-line-terminator restriction after `throw`. The invalid-punctuator lookahead also applies to comma separators. Every invalid punctuator reports `EK1010` as an error; `vibelang --fix` groups a legacy throw expression before a comma without changing its unary operand. Parenthesize the operand or the throw to place an operator inside or outside it. ECMAScript automatic semicolon insertion applies. ASI can end a class field before the `*` of a following generator method. Rules about generators and where a throw is permitted remain separate. Where throwing is permitted is separately VIP-4's 2026-10-31 no-throw ruling (`EK0401`).


<!-- grammar-admission:start -->
<!-- Generated by scripts/generate-grammar-admission.mjs from docs/design/registry/grammar-admission.tsv; DO NOT EDIT. -->

### Grammar admission inventory

This implementation census records each parser or lowering hook and its specification authority. It does not admit syntax: the productions and prose above remain the independent grammar oracle. A `pending` row has no authority; `support` and `recovery` rows do not add language forms.

<details>
<summary>Parser and lowering hooks (1024 records)</summary>

| Hook | Form | Authority | Status | Reason |
| --- | --- | --- | --- | --- |
| ` parser/vibelang.go:Parser.isVibeLangFile ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:isVibeLangDeclarationWord ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.scanStartOfVibeLangDeclaration ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.scanStartOfVibeLangDeclarationInContext ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch in the enclosing ambient context; no additional syntax |
| ` parser/vibelang.go:Parser.isStartOfVibeLangDeclaration ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.parseVibeLangDeclaration ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangSynthesized ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangIntrinsic ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangSpanning ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangModifiers ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangAbstractMember ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.parseVibeLangMutable ` | ` admission:mutable-default ` | ` - ` | ` pending ` | VIP-15 preserves native writable defaults; mutable modifier is unadopted |
| ` parser/vibelang.go:Parser.nextTokenStartsMemberNameOnSameLine ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangReadonly ` | ` admission:mutable-default ` | ` - ` | ` pending ` | VIP-15 preserves native writable defaults; mutable modifier is unadopted |
| ` parser/vibelang.go:Parser.parseVibeLangEffectType ` | ` admission:effect-type ` | ` 900-appendices.md#EffectType ` | ` support ` | VIP-3 type shorthand and slots |
| ` parser/vibelang.go:Parser.parseVibeLangSlot ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Appendix A: EffectOperand; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang.go:Parser.parseVibeLangSlotType ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Appendix A: EffectOperand; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang.go:Parser.parseServiceDeclaration ` | ` admission:service ` | ` 900-appendices.md#ServiceDeclaration ` | ` admitted ` | VIP-9 member-body and written whole-shape services; legacy control branches remain pending |
| ` parser/vibelang.go:Parser.parseLayerDeclaration ` | ` admission:layer-declaration ` | ` 007-tooling.md `, ` 900-appendices.md ` | ` recovery ` | Retired layer declarations report EK2121; recovery retains only the preserving migration |
| ` parser/vibelang.go:Parser.parseVibeLangEntityExpression ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.scanLayerValueStart ` | ` admission:layer-declaration ` | ` 007-tooling.md `, ` 900-appendices.md ` | ` recovery ` | Retired layer declarations report EK2121; recovery retains only the preserving migration |
| ` parser/vibelang.go:Parser.parseLayerValue ` | ` admission:layer-declaration ` | ` 007-tooling.md `, ` 900-appendices.md ` | ` recovery ` | Retired layer declarations report EK2121; recovery retains only the preserving migration |
| ` parser/vibelang.go:Parser.scanLayerMethodStart ` | ` admission:layer-declaration ` | ` 007-tooling.md `, ` 900-appendices.md ` | ` recovery ` | Retired layer declarations report EK2121; recovery retains only the preserving migration |
| ` parser/vibelang.go:Parser.isStartOfVibeLangProvide ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 provider parsing and support |
| ` parser/vibelang.go:Parser.scanStartOfVibeLangProvide ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 provider parsing and support |
| ` parser/vibelang.go:Parser.scanVibeLangProvideArguments ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 provider parsing and support |
| ` parser/vibelang.go:Parser.parseVibeLangProvideStatement ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement `, ` 900-appendices.md#Provider ` | ` support ` | Appendix A: ProvideStatement, Provider; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang.go:Parser.vibelangProviders ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 provider parsing and support |
| ` parser/vibelang.go:Parser.parseVibeLangCatchClauses ` | ` admission:typed-catch ` | ` - ` | ` pending ` | VIP-5 forbids Effect try statements and typed catch clauses |
| ` parser/vibelang.go:isTypedCatchClause ` | ` admission:typed-catch ` | ` - ` | ` pending ` | VIP-5 forbids Effect try statements and typed catch clauses |
| ` parser/vibelang.go:clauseAnchor ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangCatchChain ` | ` admission:typed-catch ` | ` - ` | ` pending ` | VIP-5 forbids Effect try statements and typed catch clauses |
| ` parser/vibelang.go:Parser.vibelangClauseBody ` | ` admission:typed-catch ` | ` - ` | ` pending ` | VIP-5 forbids Effect try statements and typed catch clauses |
| ` parser/vibelang.go:Parser.vibelangClauseBodyOf ` | ` admission:typed-catch ` | ` - ` | ` pending ` | VIP-5 forbids Effect try statements and typed catch clauses |
| ` parser/vibelang.go:Parser.isStartOfHandleClause ` | ` admission:handlers ` | ` - ` | ` pending ` | Open VIP-35; no admission for handler syntax |
| ` parser/vibelang.go:Parser.parseVibeLangHandleStatement ` | ` admission:handlers ` | ` - ` | ` pending ` | Open VIP-35; no admission for handler syntax |
| ` parser/vibelang.go:Parser.parseHandleClause ` | ` admission:handlers ` | ` - ` | ` pending ` | Open VIP-35; no admission for handler syntax |
| ` parser/vibelang.go:Parser.parseHandleOperation ` | ` admission:handlers ` | ` - ` | ` pending ` | Open VIP-35; no admission for handler syntax |
| ` parser/vibelang.go:Parser.vibelangClauseResumes ` | ` admission:handlers ` | ` - ` | ` pending ` | Open VIP-35; no admission for handler syntax |
| ` parser/vibelang.go:Parser.parseSchemaDeclaration ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.parseSchemaDeclaration@jsdoc-field-type ` | ` admission:schema-jsdoc-field-type ` | ` - ` | ` pending ` | VIP-15 requires an ordinary source `Type` in `Field`; JSDoc type prefixes `?`, `??`, `!` and `*` instead become an unsupported schema type with `EK2109` and lose the native syntax rejection |
| ` parser/vibelang.go:Parser.vibelangSchemaMember ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.vibelangSchemaCall ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.vibelangCalleeAnchor ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang.go:Parser.vibelangSchemaFields ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.vibelangSchemaProperties ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.vibelangUnsupportedSchema ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.vibelangNonFieldSchema ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 and detail 247 retain non-field members for EK1505 |
| ` parser/vibelang.go:Parser.vibelangSchemaOf ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping |
| ` parser/vibelang.go:Parser.vibelangSchemaPropertyName ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping keeps `__proto__` a field name |
| ` parser/vibelang.go:vibelangSchemaLiteral ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping: a union of literals, parentheses only grouping |
| ` parser/vibelang.go:vibelangSchemaUnionMembers ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping: parenthesized unions flatten in source order |
| ` parser/vibelang.go:Parser.vibelangEntityExpression ` | ` admission:declaration-support ` | ` 900-appendices.md#DeclarationStart ` | ` support ` | Declaration dispatch and synthesized node support |
| ` parser/vibelang_block_do.go:Parser.nextTokenIsBlockOrDoBlock ` | ` admission:block-do ` | ` - ` | ` pending ` | Unadopted block do recovery spelling |
| ` parser/vibelang_block_do.go:Parser.rejectVibeLangBlockDo ` | ` admission:block-do ` | ` - ` | ` pending ` | Unadopted block do recovery spelling |
| ` parser/vibelang_blocks.go:Parser.isStartOfVibeLangThrowExpression ` | ` admission:throw-expression ` | ` 900-appendices.md `, ` 003-failures.md ` | ` support ` | VIP-41: TC39 throw expressions (Appendix A ThrowExpression); EK1010 is the invalid-punctuator restriction |
| ` parser/vibelang_blocks.go:Parser.parseVibeLangThrowExpression ` | ` admission:throw-expression ` | ` 900-appendices.md `, ` 003-failures.md ` | ` support ` | VIP-41: TC39 throw expressions (Appendix A ThrowExpression); EK1010 is the invalid-punctuator restriction |
| ` parser/vibelang_blocks.go:Parser.isStartOfVibeLangDoExpression ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2 pinned do expression and completion support |
| ` parser/vibelang_blocks.go:Parser.nextTokenIsOpenBraceToken ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2 pinned do expression and completion support |
| ` parser/vibelang_blocks.go:Parser.parseVibeLangDoExpression ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2 pinned do expression and completion support |
| ` parser/vibelang_blocks.go:Parser.vibelangInvoked ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2 pinned do expression and completion support |
| ` parser/vibelang_trailing_legacy.go:Parser.isLegacyTrailingBlockStart ` | ` admission:trailing-block ` | ` 900-appendices.md ` | ` recovery ` | Denied by VIP-11; Appendix C private compatibility decoding only for EK1101 diagnosis and preserving migration; ordinary parsing stays TypeScript; not language admission |
| ` parser/vibelang_trailing_legacy.go:isLegacyTrailingBlockHead ` | ` admission:trailing-block ` | ` 900-appendices.md ` | ` recovery ` | Denied by VIP-11; Appendix C private compatibility decoding only for EK1101 diagnosis and preserving migration; ordinary parsing stays TypeScript; not language admission |
| ` parser/vibelang_trailing_legacy.go:Parser.parseLegacyTrailingBlock ` | ` admission:trailing-block ` | ` 900-appendices.md ` | ` recovery ` | Denied by VIP-11; Appendix C private compatibility decoding only for EK1101 diagnosis and preserving migration; ordinary parsing stays TypeScript; not language admission |
| ` parser/vibelang_blocks.go:isVibeLangMaskMarker ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible `, ` 900-appendices.md#Restore `, ` 900-appendices.md#Interruptible ` | ` support ` | VIP-22 internal interruption markers have no completion value; VIP-2 preserves preceding completion |
| ` parser/vibelang_catch.go:Parser.isVibeLangCatchExpression ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression ` | ` admitted ` | VIP-5 literal handler production; value handler recovery audited separately |
| ` parser/vibelang_catch.go:Parser.parseVibeLangCatchRest ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression ` | ` admitted ` | VIP-5 literal handler production; value handler recovery audited separately |
| ` parser/vibelang_catch.go:Parser.parseVibeLangCatchHandler ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression ` | ` admitted ` | VIP-5 literal handler production; value handler recovery audited separately |
| ` parser/vibelang_catch.go:Parser.nextTokenIsEqualsGreaterThanToken ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression ` | ` admitted ` | VIP-5 literal handler production; value handler recovery audited separately |
| ` parser/vibelang_data.go:Parser.scanDataName ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:Parser.parseDataDeclaration ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:Parser.parseDataVariant ` | ` admission:data ` | ` 900-appendices.md#Variant ` | ` support ` | Appendix A: Variant; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_data.go:Parser.dataDefinition ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:Parser.dataReference ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:Parser.dataType ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:Parser.dataGenericConstructors ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:Parser.dataModifiers ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:DataDefinitionName ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:IsDataDeclaration ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:DataVariants ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_data.go:IsDataConstructors ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 declarations and generated constructors |
| ` parser/vibelang_effect.go:Parser.isVibeLangEffectWord ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction ` | ` support ` | VIP-1 function-kind parsing and recovery |
| ` parser/vibelang_effect.go:Parser.scanStartOfShorthandFunction ` | ` admission:effect ` | ` 900-appendices.md#EffectShorthand ` | ` recovery ` | VIP-1: shorthand recognition only for its specified rejection |
| ` parser/vibelang_effect.go:Parser.scanStartOfEffectDeclaration ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#Producer `, ` 900-appendices.md#EffectShorthand ` | ` support ` | Appendix A: EffectFunction, Producer, EffectShorthand; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.isStartOfAsyncShorthand ` | ` admission:async-shorthand ` | ` 900-appendices.md#EffectShorthand ` | ` recovery ` | VIP-1: explicitly specified recovery for EK0101; not language admission |
| ` parser/vibelang_effect.go:Parser.parseEffectDeclaration ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#Producer `, ` 900-appendices.md#EffectShorthand ` | ` support ` | Appendix A: EffectFunction, Producer, EffectShorthand; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.parseShorthandFunctionDeclaration ` | ` admission:async-shorthand ` | ` 900-appendices.md#EffectShorthand ` | ` recovery ` | VIP-1: explicitly specified recovery for EK0101; not language admission |
| ` parser/vibelang_effect.go:Parser.markEffect ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction ` | ` support ` | VIP-1 function-kind parsing and recovery |
| ` parser/vibelang_effect.go:Parser.tryParseVibeLangEffectArrow ` | ` admission:effect ` | ` 900-appendices.md#EffectArrow ` | ` support ` | Appendix A: EffectArrow; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.tryParseVibeLangBareEffectArrow ` | ` admission:effect ` | ` 900-appendices.md#EffectArrow ` | ` recovery ` | VIP-1/detail247: bare typed or generic Effect arrow heads are recovered only to report EK0109; not language admission |
| ` parser/vibelang_effect.go:Parser.isStartOfVibeLangEffectExpression ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#EffectBlock ` | ` support ` | Appendix A: EffectFunction, EffectBlock; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.parseVibeLangEffectExpression ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#EffectBlock ` | ` support ` | Appendix A: EffectFunction, EffectBlock; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.isStartOfVibeLangEffectTypeMember ` | ` admission:effect ` | ` 001-functions.md ` | ` recovery ` | VIP-1 EK0108: recover recognized forbidden type-member modifiers for rejection and preserving removal; does not admit Effect type members |
| ` parser/vibelang_effect.go:Parser.isStartOfVibeLangEffectMember ` | ` admission:effect ` | ` 900-appendices.md#EffectMethod `, ` 900-appendices.md#ProducerMethod `, ` 900-appendices.md#EffectAccessor ` | ` support ` | Appendix A: EffectMethod, ProducerMethod, EffectAccessor; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.parseVibeLangEffectMember ` | ` admission:effect ` | ` 900-appendices.md#EffectMethod `, ` 900-appendices.md#ProducerMethod `, ` 900-appendices.md#EffectAccessor ` | ` support ` | Appendix A: EffectMethod, ProducerMethod, EffectAccessor; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_effect.go:Parser.vibelangEffectMember ` | ` admission:effect ` | ` 900-appendices.md#EffectMethod `, ` 900-appendices.md#ProducerMethod ` | ` support ` | Appendix A: EffectMethod, ProducerMethod; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_errors.go:Parser.isStartOfVibeLangSchemaError ` | ` admission:error ` | ` 900-appendices.md#SchemaErrorDeclaration ` | ` support ` | Appendix A: SchemaErrorDeclaration; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_errors.go:Parser.parseErrorDeclaration ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration `, ` 900-appendices.md#SchemaErrorDeclaration ` | ` support ` | Appendix A: ErrorDeclaration, SchemaErrorDeclaration; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_errors.go:Parser.parseErrorDeclaration@jsdoc-schema-field-type ` | ` admission:schema-jsdoc-field-type ` | ` - ` | ` pending ` | VIP-29 maps schema-error fields through VIP-15; recovered JSDoc type prefixes leave only `EK2109` after mapping instead of a native syntax rejection |
| ` parser/vibelang_errors.go:Parser.parseVibeLangErrorHeritage ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.isVibeLangFieldComma ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.parseVibeLangFieldComma ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.parseVibeLangErrorElement ` | ` admission:error ` | ` 900-appendices.md#ErrorBody ` | ` support ` | Appendix A: ErrorBody; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_errors.go:isVibeLangErrorField ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:isVibeLangTagField ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorFieldSignatures ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangMoveJSDoc ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorFields ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:slicesSortByPos ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorTag ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorHeritage ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorRoot ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorSelf ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangSchemaErrorFields ` | ` admission:error ` | ` 900-appendices.md#SchemaErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangSchemaErrorRoot ` | ` admission:error ` | ` 900-appendices.md#SchemaErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangSchemaErrorSubclass ` | ` admission:error ` | ` 900-appendices.md#SchemaErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorRegistration ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-7/13/29 own error tag matchers and schema-family registration |
| ` parser/vibelang_errors.go:Parser.vibelangErrorSubclass ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangDeclareField ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangErrorConstructor ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_errors.go:Parser.vibelangSynthesizedEntityName ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration ` | ` support ` | VIP-13/29 error declarations, members and recovery |
| ` parser/vibelang_fibers.go:Parser.tokenRange ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.isStartOfVibeLangFork ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangFork ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangForkOwner ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 named owners fork.in, fork.scoped and fork.detached, with EK1705 for another name |
| ` vibelang/fork_owners.go:checkForkOwner ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 reports EK1703 and EK1706 for named fork owners |
| ` vibelang/fork_owners.go:forkOwnerRejected ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 lets EK1703 and EK1706 own a generated call's argument error |
| ` vibelang/fork_owners.go:forkScopeRejected ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 fork.in scope assignability, EK1706 |
| ` vibelang/fork_owners.go:init ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 registers EK1705 and EK1706 |
| ` vibelang/fork_owners.go:isForkOwner ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 recognizes fork.in, fork.scoped and fork.detached calls |
| ` vibelang/fork_owners.go:lowering.forkOwnerCall ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 writes Effect.forkIn, forkScoped or forkDetach, with the scope first |
| ` parser/vibelang_fibers.go:Parser.forkBraceIsObjectOperand ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 brace after fork in Effect code is an object UnaryExpression, as after await |
| ` parser/vibelang_fibers.go:Parser.isStartOfVibeLangJoin ` | ` admission:join ` | ` 900-appendices.md#JoinExpression ` | ` support ` | VIP-17 single Fiber operand; aggregate meaning not admitted |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangJoin ` | ` admission:join ` | ` 900-appendices.md#JoinExpression ` | ` support ` | VIP-17 single Fiber operand; aggregate meaning not admitted |
| ` parser/vibelang_fibers.go:Parser.vibelangProgramArrow ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.inNativeAwaitContext ` | ` admission:native-await-context ` | ` 001-functions.md `, ` 007-tooling.md ` | ` support ` | VIP-26 native await grammar keeps TS1308 in synchronous namespace bodies without inheriting module suspension permission |
| ` parser/vibelang_fibers.go:Parser.isVibeLangAwait ` | ` admission:legacy-await ` | ` - ` | ` pending ` | VIP-5/18 replace implicit await and await operations |
| ` parser/vibelang_fibers.go:Parser.nextTokenStartsAwaitOperand ` | ` admission:legacy-await ` | ` - ` | ` pending ` | VIP-5/18 replace implicit await and await operations |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangAwait ` | ` admission:legacy-await ` | ` - ` | ` pending ` | VIP-5/18 replace implicit await and await operations |
| ` parser/vibelang_fibers.go:Parser.isVibeLangAwaitOperation ` | ` admission:legacy-await ` | ` - ` | ` pending ` | VIP-5/18 replace implicit await and await operations |
| ` parser/vibelang_fibers.go:Parser.nextTokensStartAwaitOperation ` | ` admission:legacy-await ` | ` - ` | ` pending ` | VIP-5/18 replace implicit await and await operations |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangAwaitOperation ` | ` admission:legacy-await ` | ` - ` | ` pending ` | VIP-5/18 replace implicit await and await operations |
| ` parser/vibelang_fibers.go:Parser.isStartOfVibeLangSelect ` | ` admission:select ` | ` - ` | ` pending ` | No accepted VIP adopts select syntax |
| ` parser/vibelang_fibers.go:Parser.nextTokenIsOpenBraceOnSameLine ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangSelect ` | ` admission:select ` | ` - ` | ` pending ` | No accepted VIP adopts select syntax |
| ` parser/vibelang_fibers.go:Parser.labelSelectBreaks ` | ` admission:select ` | ` - ` | ` pending ` | No accepted VIP adopts select syntax |
| ` parser/vibelang_fibers.go:Parser.jumpKeywordRange ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:isFunctionOrClassBoundary ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.isVibeLangConcurrentFor ` | ` admission:for-concurrent ` | ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19 concurrent loop |
| ` parser/vibelang_fibers.go:Parser.nextTokenIsOpenParenOnSameLine ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17/19 fork and concurrent-loop helpers; legacy paths below |
| ` parser/vibelang_fibers.go:Parser.nextTokenStartsConcurrentDeclaration ` | ` admission:for-concurrent ` | ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19 declaration and assignment head recovery distinguishes the head from a limit; invalid heads receive EK1906 |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangConcurrentFor ` | ` admission:for-concurrent ` | ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19 concurrent loop |
| ` parser/vibelang_concurrent_returns.go:Parser.doConcurrentItemReturn ` | ` admission:for-concurrent ` | ` 900-appendices.md#ForConcurrent `, ` 002-running.md ` | ` recovery ` | VIP-19: an outward return in concurrent item work (computed names, heritage, head initializers) reports EK1904; admits no syntax (e9aca6d3) |
| ` parser/vibelang_fibers.go:Parser.rewriteConcurrentJumps ` | ` admission:for-concurrent ` | ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19 concurrent loop |
| ` parser/vibelang_match.go:Parser.isStartOfVibeLangMatch ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 900-appendices.md#AsyncMatchExpression ` | ` support ` | Appendix A: MatchExpression, AsyncMatchExpression; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_match.go:Parser.scanStartOfVibeLangMatch ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 900-appendices.md#AsyncMatchExpression ` | ` support ` | Appendix A: MatchExpression, AsyncMatchExpression; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_match.go:Parser.isMatchWord ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseVibeLangMatch ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 900-appendices.md#AsyncMatchExpression ` | ` support ` | Appendix A: MatchExpression, AsyncMatchExpression; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_match.go:Parser.combinatorWord ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseMatchPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseMatchUnaryPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.nextTokenStartsPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.tokenStartsPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseMatchPrimaryPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseMatchValueExpression ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseMatchListPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.parseMatchObjectPattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.isVibeLangIs ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:VibeLangIsRecoveryBindingDeclaration ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 004-match.md ` | ` recovery ` | VIP-7: identifies a rejected duplicate is binding so the binder gives it a recovery symbol; introduces no syntax (6a741ef0) |
| ` parser/vibelang_match.go:VibeLangIsInitializerDeclaration ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 004-match.md ` | ` recovery ` | VIP-7: maps a generated is-pattern assignment to its recovery declaration; source references keep ordinary lexical resolution; introduces no syntax (6a741ef0) |
| ` parser/vibelang_match.go:Parser.parseVibeLangIs ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:patternHasBindings ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mIdent ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mTemp ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.freshenVibeLangTemps ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 900-appendices.md#DataDeclaration `, ` 006-data.md ` | ` support ` | VIP-7 matcher temporary hygiene and VIP-28 generic-data helper names follow lexical identifier roles |
| ` parser/vibelang_match.go:Parser.mToken ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mString ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mBinary ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mParens ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mCall ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mProperty ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mElement ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mNumber ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mKeyword ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mBlock ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mConst ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.patternErrorCall ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.cloneIdentExpression ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.subjectPath ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.propertyPath ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:isLiteralKey ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.patternKeyType ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 preserves the source computed key type while capturing its runtime property key once |
| ` parser/vibelang_match.go:Parser.capturePatternKey ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 evaluates and converts each computed key once before presence, value and rest operations |
| ` parser/vibelang_match.go:Parser.propertyKeyTest ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:BuiltinMatcherNamed ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:dottedName ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.matcherTest ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.compilePattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:IsSignedNumberZero ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.enterSubject ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:isPropertyChain ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:subjectReads ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.compileList ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.inlinePattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.inlineNotPattern ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7 negated patterns keep binding declarations in the outer home and initialize them conditionally |
| ` parser/vibelang_match.go:Parser.joinTests ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:testsSpan ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.emitSteps ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.isExpression ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.matchStatements ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.matchFunctionCall ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.matchReturnStatement ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.matchReturnStatementAt ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.matchStatement ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:conjuncts ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.conditionSteps ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:endsInJump ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.restructureVibeLangWhile ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.keywordRangeAt ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 pinned matcher parsing and lowering helpers |
| ` parser/vibelang_match.go:Parser.mPatternRead ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 marks property and positional reads for match binding type inference |
| ` parser/vibelang_match.go:Parser.hoistVibeLangIs ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.hoistDeclaration ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.hoistStatementIs ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.hoistConciseBody ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.hoistInitializerBody ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.hoistForHead ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.recordForEachIsHome ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7: records separate RHS and destructuring-default binding homes for for-in/of heads |
| ` parser/vibelang_match.go:hoistedDeclarator ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.mLetList ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.takeHoists ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_match.go:Parser.parseEmbeddedStatement ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7 / Chapter 004 binding homes for `is`; synthesized `let` hoisting supports explicit source homes |
| ` parser/vibelang_modules.go:Parser.isStartOfVibeLangModuleDeclaration ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.parseVibeLangModuleDeclaration ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.skipTypeScriptModuleBody ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.parseVibeLangModuleReference ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.parseVibeLangModuleReference@require-identifier ` | ` admission:module-require-identifier ` | ` - ` | ` pending ` | VIP-40 admits identifier specifiers in static import declarations; the inherited TypeScript `ExternalModuleReference` requires a `StringLiteral`, but this shared path also accepts `require(identifier)` |
| ` parser/vibelang_modules.go:Parser.vibelangModuleReference ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.isVibeLangModuleImport ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.parseVibeLangModuleImport ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:moduleDeclarationFileNamePart ` | ` admission:inline-module ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: injective portable encoding preserves exact module names, including case and Unicode distinctions |
| ` parser/vibelang_modules.go:ModuleDeclarationFileSuffix ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:ModuleDeclarationSpecifier ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:IsVibeLangModuleDeclaration ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:IsVibeLangModuleReference ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:ModuleDeclarationBody ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:Parser.attachVibeLangModules ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:parseModuleBody ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_modules.go:blankOutside ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` parser/vibelang_pipes.go:Parser.isPipeOperator ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 pinned Hack pipe and topic |
| ` parser/vibelang_pipes.go:Parser.parsePipeRest ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 pinned Hack pipe and topic |
| ` parser/vibelang_pipes.go:isFunctionLiteral ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 pinned Hack pipe and topic |
| ` parser/vibelang_pipes.go:runsCall ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 pinned Hack pipe and topic |
| ` parser/vibelang_pipes.go:Parser.parseTopicReference ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 pinned Hack pipe and topic |
| ` parser/vibelang_pipes.go:curriedPipeStage ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 pinned Hack pipe and topic |
| ` parser/vibelang_pipes.go:Parser.parsePipeBodyBinaryOrArrow ` | ` admission:pipe ` | ` 900-appendices.md#PipeBody ` | ` recovery ` | VIP-23/details246-247: recover a whole bare arrow and report EK2301; parentheses and nested arrows keep their existing admission |
| ` parser/vibelang_pipes.go:Parser.rejectPipeConditional ` | ` admission:pipe ` | ` 900-appendices.md#PipeBody ` | ` recovery ` | EK2301: a conditional after a pipe body has no valid reading; not language admission |
| ` parser/vibelang_primitives.go:isVibeLangMaskWord ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible `, ` 900-appendices.md#Restore `, ` 900-appendices.md#Interruptible ` | ` support ` | Appendix A: Uninterruptible, Restore, Interruptible; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_primitives.go:Parser.isStartOfVibeLangMaskBlock ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible `, ` 900-appendices.md#Restore `, ` 900-appendices.md#Interruptible ` | ` support ` | Appendix A: Uninterruptible, Restore, Interruptible; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_primitives.go:Parser.parseVibeLangMaskBlock ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible `, ` 900-appendices.md#Restore `, ` 900-appendices.md#Interruptible ` | ` support ` | Appendix A: Uninterruptible, Restore, Interruptible; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_primitives.go:Parser.parseVibeLangFinallyBlock ` | ` admission:finally-exit ` | ` - ` | ` pending ` | VIP-5 forbids Effect try/finally syntax |
| ` parser/vibelang_primitives.go:isCauseCatchClause ` | ` admission:finally-exit ` | ` - ` | ` pending ` | VIP-5 forbids Effect try/finally syntax |
| ` parser/vibelang_schema_alias.go:Parser.scanSchemaAliasStart ` | ` admission:schema-alias ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 aliases and companions |
| ` parser/vibelang_schema_alias.go:Parser.parseSchemaAliasDeclaration ` | ` admission:schema-alias ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 aliases and companions |
| ` parser/vibelang_schema_alias.go:Parser.vibelangSchemaType ` | ` admission:schema-alias ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 aliases and companions |
| ` parser/vibelang_schema_alias.go:Parser.vibelangCompanionLoc ` | ` admission:schema-alias ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 aliases and companions |
| ` parser/vibelang_schema_alias.go:IsSchemaAliasDeclaration ` | ` admission:schema-alias ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 aliases and companions |
| ` parser/vibelang_schema_tuple.go:Parser.vibelangSchemaTuple ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:Parser.vibelangSchemaTupleGrammar ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:Parser.vibelangSchemaTuplePositions ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:schemaTupleElement ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:schemaLiteralRestTuple ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:schemaTupleHasArrayRest ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:Parser.schemaTupleUnion ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:Parser.schemaTupleUndefined ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_schema_tuple.go:vibelangSchemaRestElement ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 schema mapping of literal variadic tuple types |
| ` parser/vibelang_service_heritage.go:Parser.skipVibeLangServiceHeritage ` | ` admission:service-heritage ` | ` 900-appendices.md#ServiceDeclaration ` | ` recovery ` | VIP-9 forbidden heritage diagnostic recovery |
| ` parser/vibelang_service_type.go:Parser.parseServiceShapeDeclaration ` | ` admission:service-shape ` | ` 900-appendices.md#ServiceDeclaration ` | ` admitted ` | VIP-9 accepts a written whole shape with a required body containing only `key` and `defaultValue` members |
| ` parser/vibelang_syntax.go:ParseVibeLangSyntax ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.recordVibeSyntax ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.vibelangSyntaxCount ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.vibelangSyntaxRewind ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.sourceRange ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.blockBraces ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.recordVibeSyntaxBlock ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_syntax.go:Parser.recordVibeSyntaxClause ` | ` admission:syntax-records ` | ` 007-tooling.md ` | ` support ` | VIP-34 source spans for tooling; records grant no syntax authority |
| ` parser/vibelang_try.go:Parser.isStartOfVibeLangTry ` | ` admission:try ` | ` 900-appendices.md#TryExpression `, ` 900-appendices.md#TryAll ` | ` support ` | Appendix A: TryExpression, TryAll; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_try.go:Parser.nextTokenStartsTryOperand ` | ` admission:try ` | ` 900-appendices.md#TryExpression ` | ` support ` | VIP-5 try execution and VIP-18 operations |
| ` parser/vibelang_try.go:Parser.parseVibeLangTry ` | ` admission:try ` | ` 900-appendices.md#TryExpression `, ` 900-appendices.md#TryAll ` | ` support ` | Appendix A: TryExpression, TryAll; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` vibelang/try_operations.go:init ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18: registers EK1801, its file check and the object quick fix; introduces no syntax |
| ` vibelang/try_operations.go:tryOperationName ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: names the reparsed try.all, try.race, try.any or try.allSettled call; introduces no syntax |
| ` vibelang/try_operations.go:checkTryOperations ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: EK1801 rejects an operand that is not an array of Effects (Appendix B); introduces no syntax |
| ` vibelang/try_operations.go:coverTryOperationOperand ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 `TryAll`: covers only the rejected array operand mismatch while preserving independent native errors; introduces no syntax |
| ` vibelang/try_operations.go:tryOperationArrayType ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: EK1801 operand assignability to ReadonlyArray<Effect>; introduces no syntax |
| ` vibelang/try_operations.go:filterRejectedTryOperationArgumentDiagnostics ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md `, ` 007-tooling.md ` | ` support ` | VIP-18 and VIP-34: `EK1801` replaces only the generated operand mismatch; written native errors remain; introduces no syntax |
| ` vibelang/try_operations.go:tryOperationEffectType ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: EK1801 element assignability to Effect; introduces no syntax |
| ` vibelang/try_operations.go:tryOperationImportPosition ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18: import placement for the EK1801 object quick fix; introduces no syntax |
| ` vibelang/try_operations.go:lowering.nativeTryAllCall ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: writes Effect.all through the project's Effect instance with unbounded concurrency; introduces no syntax |
| ` vibelang/try_operations.go:trySettledLiteral ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: selects a no-spread array literal operand of try.allSettled for direct lowering (5c1a266c); introduces no syntax |
| ` vibelang/try_operations.go:lowering.visitTrySettledLiteral ` | ` admission:try ` | ` 900-appendices.md#TryAll `, ` 002-running.md ` | ` support ` | VIP-18 TryAll: lowers try.allSettled over a no-spread array literal per element, without a helper array (5c1a266c); introduces no syntax |
| ` vibelang/effect_functions.go:isMarkedEffect ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#EffectBlock ` | ` support ` | VIP-1/2: a function marked effect or an effect block is an Effect function; introduces no syntax |
| ` vibelang/effect_functions.go:isEffectBlock ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#EffectBlock ` | ` support ` | VIP-2: recognizes the arrow the parser writes for an effect block; introduces no syntax |
| ` vibelang/effect_functions.go:markedForm ` | ` admission:effect ` | ` 900-appendices.md#EffectFunction `, ` 900-appendices.md#EffectBlock ` | ` support ` | VIP-1/2: the form a marked function or effect block compiles to, catch-left functions included; introduces no syntax |
| ` vibelang/effect_functions.go:isCatchLeftFunction ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5: recognizes the function the parser writes around a catch expression's left side; introduces no syntax |
| ` vibelang/effect_functions.go:isCatchHandlerOf ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5: recognizes a catch expression's handler literal; introduces no syntax |
| ` vibelang/effect_functions.go:holdsTry ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5: a try outside nested functions in a catch's left side; introduces no syntax |
| ` vibelang/effect_functions.go:isCatchLeftBody ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5: the whole left side of a catch expression, through parentheses; introduces no syntax |
| ` vibelang/effect_functions.go:catchLeftHoldsTry ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5 (amended 2026-10-29): a try in a catch's left side runs before the catch, in the enclosing Effect (11cde8f5); introduces no syntax |
| ` vibelang/effect_functions.go:lowering.visitCatchLeftValue ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5: lowers a catch whose left side holds a try to pass the value it gives (11cde8f5); introduces no syntax |
| ` parser/vibelang_try.go:triedChainOperand ` | ` admission:try ` | ` 900-appendices.md#TryExpression ` | ` support ` | VIP-5 try execution and VIP-18 operations |
| ` parser/vibelang_try.go:Parser.isVibeLangTryOperation ` | ` admission:try ` | ` 900-appendices.md#TryAll ` | ` support ` | Appendix A: TryAll; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_try.go:Parser.parseVibeLangTryOperation ` | ` admission:try ` | ` 900-appendices.md#TryAll ` | ` support ` | Appendix A: TryAll; inherited TypeScript helpers and diagnostic recovery retain their stated boundaries |
| ` parser/vibelang_try.go:isVibeLangTry ` | ` admission:try ` | ` 900-appendices.md#TryExpression ` | ` support ` | VIP-5: try (try e) runs both layers; the inner try stays the operand |
| ` parser/vibelang_retired_controls.go:Parser.retiredControlForm ` | ` admission:retired-control-forms ` | ` 000-intro.md ` | ` recovery ` | First-release handler retirement reports EK3501/EK4607 and names --fix; recovery supports diagnostics and migration, never admission of open VIP-35 forms. |
| ` vibelang/catches.go:init ` | ` admission:catch-tests ` | ` 003-failures.md ` | ` support ` | Failure test support; legacy typed catch syntax audited separately |
| ` vibelang/catches.go:isFailureTest ` | ` admission:catch-tests ` | ` 003-failures.md ` | ` support ` | Failure test support; legacy typed catch syntax audited separately |
| ` vibelang/catches.go:failureTags ` | ` admission:catch-tests ` | ` 003-failures.md ` | ` support ` | Failure test support; legacy typed catch syntax audited separately |
| ` vibelang/catches.go:lowering.visitFailureTest ` | ` admission:catch-tests ` | ` 003-failures.md ` | ` support ` | Failure test support; legacy typed catch syntax audited separately |
| ` vibelang/catches.go:checkCatchClauses ` | ` admission:catch-tests ` | ` 003-failures.md ` | ` support ` | Failure test support; legacy typed catch syntax audited separately |
| ` vibelang/chains_lower.go:optionalLink ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:lowering.guardedLink ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:writesQuestionDot ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:lowering.mayYield ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:lowering.visitGuardedChain ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:lowering.visitGuardedLink ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:lowering.invokeGuarded ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/chains_lower.go:lowering.boundThunk ` | ` admission:implicit-running ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/data_lower.go:newDataPlan ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 constructors |
| ` vibelang/data_lower.go:dataPlan.planVariantTest ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 constructors |
| ` vibelang/data_lower.go:dataPlan.withoutUnusedIs ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 constructors |
| ` vibelang/data_lower.go:lowering.visitVariantTest ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16/28 constructors |
| ` vibelang/datamethods.go:init ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:methodStateOf ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:homeModule ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:effectModuleOfFile ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:moduleMethod ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:methodProperty ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:takesSelfFirst ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:TakesSelfFirst ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:dataFunctionOf ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:effectModuleNamespace ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:methodCallOf ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:methodModuleOf ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:checkModuleMethods ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:namesPreludeModule ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:moduleMethodQuickInfo ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:moduleMethodCompletions ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:lowering.moduleNamespace ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/datamethods.go:lowering.visitModuleMethodCall ` | ` admission:extension-methods ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/direct.go:lowering.directEffect ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/direct.go:lowering.directResult ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/direct.go:lowering.namedThunk ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/direct.go:lowering.tailCompletion ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2/5: a tail return keeps its condition and comma evaluation in the source scope and records whether it needs native yield* delegation; admits no form |
| ` vibelang/direct.go:lowering.delegatedTail ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2/5: a tail return delegates to the thunk captured outside the generator, keeping this, arguments, super and new.target in the source callable; admits no form |
| ` parser/vibelang_schema_written_type.go:vibelangSchemaTypeQuery ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15/27 foldkit-9 amendment: one written alias type T = typeof T.Type replaces the synthesized schema type; the parser admits no new form |
| ` parser/vibelang_schema_written_type.go:Parser.vibelangSynthesizedSchemaType ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15/27 foldkit-9 amendment: one written alias type T = typeof T.Type replaces the synthesized schema type; the parser admits no new form |
| ` parser/vibelang_schema_written_type.go:Parser.vibelangWrittenSchemaTypes ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15/27 foldkit-9 amendment: one written alias type T = typeof T.Type replaces the synthesized schema type; the parser admits no new form |
| ` parser/vibelang_schema_written_type.go:Parser.vibelangWrittenSchemaSwitchTypes ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15/27 foldkit-9 amendment: one written alias type T = typeof T.Type replaces the synthesized schema type; the parser admits no new form |
| ` vibelang/direct.go:hasSimpleParameters ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/entry.go:entryRuntime ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:init ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:checkPlatformImports ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:namedPlatform ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:platformImport ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:entryModules ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:entryCandidate ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:entryMain ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:containsTopLevelRunner ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:startsProgram ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:planEntry ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:entryBundles ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:neededServices ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:provides ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:platformNote ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:resolvedModuleFile ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:bundleServices ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:lowering.entryReference ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/entry.go:lowering.entryStatement ` | ` admission:magic-main ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/frames_lower.go:findFrameReferences ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:bindsFrame ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:frameBindings ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:isNewTarget ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:opensFrame ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:isSuperProperty ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:frameBody ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:lowering.forwarding ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:lowering.hoistFrameReferences ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:isSuperAssignment ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:isAssignmentTarget ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:lowering.superKey ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:lowering.declareFrameBindings ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:refersToOwnName ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:lowering.nameFreeGenerator ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/frames_lower.go:lowering.selfBoundFunction ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: explicit Effect callable bindings and direct-return optimization; implicit kind/by-name conversions removed by VIP-1 flip |
| ` vibelang/generated.go:lowering.generated ` | ` admission:source-map-support ` | ` 007-tooling.md ` | ` support ` | VIP-34: generated function source-map support; grants no implicit function-literal conversion |
| ` vibelang/generated.go:lowering.generatedFunctions ` | ` admission:source-map-support ` | ` 007-tooling.md ` | ` support ` | VIP-34: generated function source-map support; grants no implicit function-literal conversion |
| ` vibelang/generated.go:lowering.generatedThunk ` | ` admission:source-map-support ` | ` 007-tooling.md ` | ` support ` | VIP-34: generated function source-map support; grants no implicit function-literal conversion |
| ` vibelang/generated.go:isProgramArrow ` | ` admission:source-map-support ` | ` 007-tooling.md ` | ` support ` | VIP-34: generated function source-map support; grants no implicit function-literal conversion |
| ` vibelang/generated.go:programArrowRole ` | ` admission:source-map-support ` | ` 007-tooling.md ` | ` support ` | VIP-34: generated function source-map support; grants no implicit function-literal conversion |
| ` vibelang/generated.go:lowering.markProgramArrows ` | ` admission:source-map-support ` | ` 007-tooling.md ` | ` support ` | VIP-34: generated function source-map support; grants no implicit function-literal conversion |
| ` vibelang/handlers.go:runtimeExport ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:handleCallOfClause ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:resumeKind ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:newHandlerPlan ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:handlerPlan.planClause ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:handlerPlan.planResume ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:plan.resumesInTail ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:handlerPlan.tailResumeOf ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:handlerPlan.isTailResumeBody ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:lowering.visitTailResumeReturn ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:lowering.tailResumeCall ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:init ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:checkResumeWith ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:checkResumeWithProgram ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handlers.go:operationOfClause ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:init ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:isHandleStatement ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:isClauseBinding ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:catches ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:isClauseOperation ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:isClauseCallee ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:isClauseContinuation ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:handleClauseOfBlock ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:handleClauses ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:controlGroups ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:entityText ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:analyzer.handleFlow ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:withoutRequirement ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:hasVibeLangStatement ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:hasHandleStatement ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:checkHandleStatements ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:checkHandleClauses ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:isControlDeclaration ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.isClauseResume ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.visitHandleStatement ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.clauseStatements ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.clauseFunction ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.pendingOf ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.visitClauseResume ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/handles.go:lowering.visitClauseResumeReturn ` | ` admission:handlers ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchOf ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:shadowed ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:isHatchArgument ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:isWrappedCode ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:forEachHatchVibeLang ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:inHatch ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:init ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:takesFewerInputs ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchIsland ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:outsideReferences ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:outsideNames ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:wrappedCall ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:boundaryCall ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:inputConsts ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:boundaryInputs ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:analyzer.runsVibeLang ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:receiverParameterName ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:argumentParameterName ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:isHatchValueReference ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:declaredOutside ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:isTaggedErrorClass ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hasProperty ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchFormOf ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:takesSignal ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:bindsExactly ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchPromiseOf ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:promisenessOf ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:joinPromiseness ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:lowering.visitHatchCall ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchQuickInfo ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:lowering.adapterHatchCall ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchInputs ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:hatchInputEdits ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:parenthesized ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hatches.go:edit ` | ` admission:hatches ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/hygiene.go:freshNames.freshName ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:freshNames.spelled ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:lowering.reachIntrinsics ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:lowering.intrinsicReference ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:lowering.freshName ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:lowering.directName ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:variantExportName ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/hygiene.go:moduleExportNames ` | ` admission:hygiene ` | ` 007-tooling.md ` | ` support ` | VIP-34 generated name hygiene |
| ` vibelang/imports.go:lowering.visitImportOrExport ` | ` admission:imports ` | ` 007-tooling.md ` | ` support ` | VIP-34 emitted module specifiers |
| ` vibelang/imports.go:lowering.outputSpecifier ` | ` admission:imports ` | ` 007-tooling.md ` | ` support ` | VIP-34 emitted module specifiers |
| ` vibelang/imports.go:outputSpecifierText ` | ` admission:imports ` | ` 007-tooling.md ` | ` support ` | VIP-34 emitted module specifiers |
| ` vibelang/imports.go:outputSpecifierTextWithJSX ` | ` admission:imports ` | ` 007-tooling.md ` | ` support ` | VIP-34 emitted module specifiers |
| ` vibelang/lower.go:newLowering ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visit ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visitSource ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visitNode ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visitCatchLeftValue ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 002-running.md ` | ` support ` | VIP-5 (amended 2026-10-29): a try in a catch's left side runs before the catch, which receives the value the left side gives |
| ` vibelang/lower.go:lowering.visitSourceFile ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.namespaceImport ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.fileName ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.effectName ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visitThrowStatement ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.runtimeMember ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.succeedByName ` | ` admission:implicit-running ` | ` - ` | ` pending ` | VIP-1/5 require explicit effect kind and execution; implicit conversion is legacy |
| ` vibelang/lower.go:lowering.runtimeCall ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visitRunningCall ` | ` admission:implicit-running ` | ` - ` | ` pending ` | VIP-1/5 require explicit effect kind and execution; implicit conversion is legacy |
| ` vibelang/lower.go:lowering.lowerFunction ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.lowerProgram ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/frames_lower.go:lowering.lexicalReceiver ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1/2: capture lexical `this` without reading it until execution reaches the body read |
| ` vibelang/lower.go:lowering.generatorOf ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.generatorFrom ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.loweredBody ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.directFunction ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.wrapGenerator ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:functionName ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.visitEffectFunctionDeclaration ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/lower.go:lowering.effectFunctionDeclaration ` | ` admission:function-lowering ` | ` 001-functions.md ` | ` support ` | Function lowering machinery; legacy implicit conversions below |
| ` vibelang/match_builtins.go:init ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:checkBuiltinPatterns ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:builtinMatcherOf ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:effectModuleNamed ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:isBuiltinPatternTest ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:builtinVariantProperty ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:narrowBuiltinPattern ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:lowering.visitBuiltinTest ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:builtinExtractionType ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:narrowBuiltinExtraction ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:builtinGuardType ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed built-in matchers |
| ` vibelang/match_builtins.go:builtinGuardPredicate ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 fixed guard predicates use their TypeScript constraints |
| ` vibelang/match_lower.go:newExhaustivePlan ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 runtime matcher tests |
| ` vibelang/match_lower.go:exhaustivePlan.planExhaustiveMatch ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 runtime matcher tests |
| ` vibelang/match_lower.go:exhaustivePlan.withoutUnusedNoMatch ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 runtime matcher tests |
| ` vibelang/match_lower.go:lowering.visitCheckedArm ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 runtime matcher tests |
| ` vibelang/match_cache_lower.go:lowering.visitMatchCacheBlock ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: native FinishMatch cleanup runs on JavaScript completions without resuming failed Effect generators |
| ` vibelang/match_cache_lower.go:lowering.visitMatchCacheCondition ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: native FinishMatch cleanup runs on JavaScript completions without resuming failed Effect generators |
| ` vibelang/methods.go:analyzer.expectsEffect ` | ` admission:effect-method ` | ` 900-appendices.md#EffectMethod ` | ` support ` | VIP-1 method lowering; legacy unmodified methods audited as function-kind |
| ` vibelang/methods.go:lowering.lowerMethod ` | ` admission:effect-method ` | ` 900-appendices.md#EffectMethod ` | ` support ` | VIP-1 method lowering; legacy unmodified methods audited as function-kind |
| ` vibelang/methods.go:lowering.methodName ` | ` admission:effect-method ` | ` 900-appendices.md#EffectMethod `, ` 002-running.md ` | ` support ` | VIP-1 method lowering; a computed method name runs where its class is defined (chapter 2) |
| ` vibelang/methods.go:lowering.perRunMethod ` | ` admission:effect-method ` | ` 900-appendices.md#EffectMethod ` | ` support ` | VIP-1 method lowering; legacy unmodified methods audited as function-kind |
| ` vibelang/methods.go:usesThis ` | ` admission:effect-method ` | ` 900-appendices.md#EffectMethod ` | ` support ` | VIP-1 method lowering; legacy unmodified methods audited as function-kind |
| ` vibelang/names.go:lowering.generatorExpression ` | ` admission:names ` | ` 001-functions.md ` | ` support ` | VIP-1 function name preservation |
| ` vibelang/names.go:refersTo ` | ` admission:names ` | ` 001-functions.md ` | ` support ` | VIP-1 function name preservation |
| ` vibelang/names.go:refersToName ` | ` admission:names ` | ` 001-functions.md ` | ` support ` | VIP-1 function name preservation |
| ` vibelang/names.go:parameterRefersTo ` | ` admission:names ` | ` 001-functions.md ` | ` support ` | VIP-1 function name preservation |
| ` vibelang/names.go:sourceName ` | ` admission:names ` | ` 001-functions.md ` | ` support ` | VIP-1 function name preservation |
| ` vibelang/names.go:lowering.captureValue ` | ` admission:names ` | ` 001-functions.md ` | ` support ` | RC-33: preserve source NamedEvaluation for emitter-generated value captures before class static initialization |
| ` vibelang/order.go:stableValue ` | ` admission:evaluation-order ` | ` 002-running.md ` | ` support ` | VIP-19 concurrent loop and evaluation order |
| ` vibelang/order.go:stableSymbol ` | ` admission:evaluation-order ` | ` 002-running.md ` | ` support ` | VIP-19 concurrent loop and evaluation order |
| ` vibelang/order.go:isNamespaceValue ` | ` admission:evaluation-order ` | ` 002-running.md ` | ` support ` | VIP-19 concurrent loop and evaluation order |
| ` vibelang/order.go:plan.noteStable ` | ` admission:evaluation-order ` | ` 002-running.md ` | ` support ` | VIP-19 concurrent loop and evaluation order |
| ` vibelang/order.go:lowering.inOrder ` | ` admission:evaluation-order ` | ` 002-running.md ` | ` support ` | VIP-19 concurrent loop and evaluation order |
| ` vibelang/order.go:lowering.concurrentForCall ` | ` admission:evaluation-order ` | ` 002-running.md ` | ` support ` | VIP-19 concurrent loop and evaluation order |
| ` vibelang/pipes_lower.go:plan.planPipe ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:topicFirst ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:evaluatedBefore ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:evaluatedSometimes ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:topicClosure ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:lowering.visitPipe ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:lowering.visitTopic ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/pipes_lower.go:lowering.visitTopicClosure ` | ` admission:pipe ` | ` 900-appendices.md#PipeExpression ` | ` support ` | VIP-23 single evaluation and topic substitution |
| ` vibelang/primitives.go:init ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:maskWord ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:maskMarkerWord ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:isRemovedPrimitiveMarker ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:isExitMarkerCall ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:exitBinding ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:exitBindingOf ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:isCauseCatch ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:isCauseVariable ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:hasPrimitiveStatement ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:primitivesOf ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:causeInterface ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:causeVariableType ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:exitCallType ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:enclosingTryOfFinally ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:checkPrimitives ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:isUninterruptibleProgram ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:primitiveQuickInfo ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/primitives.go:lowering.visitMaskBlock ` | ` admission:interruption ` | ` 900-appendices.md#Uninterruptible ` | ` support ` | VIP-22 interruption lowering |
| ` vibelang/producers.go:isProducer ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:producersOf ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:streamInterface ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:producerType ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:streamChannel ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:iteratedElementType ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:isStreamLoop ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:forEachStreamLoop ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:analyzer.hasStreamLoop ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:analyzer.addStreamLoop ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:newProducerPlan ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:producerPlan.planProducer ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:isClosingLoop ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:bodyPauses ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.visitProducer ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:bindingMayThrow ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.producerBindingBoundary ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.visitYield ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.visitStreamLoop ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.closingLoopLabel ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.runForOf ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.loopBodyStatements ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 producer and yield lowering |
| ` vibelang/producers.go:lowering.runForTry ` | ` admission:for-try ` | ` 900-appendices.md#ForTry ` | ` support ` | VIP-20 consumes a Stream with runForEachWhile |
| ` vibelang/producers.go:lowering.javaScriptIterable ` | ` admission:native-for-of ` | ` 900-appendices.md ` | ` support ` | Appendix A inherits TypeScript for...of; preserve native IteratorClose and next argument counts even for Stream-branded iterables |
| ` vibelang/provide.go:init ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:isProvideBlock ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:isProvideLayer ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:provideLayer ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:hasProvideBlock ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:analyzer.provideFlow ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:emptyProvider ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:combineProviders ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerExpression ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerChannelsOf ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerType ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerTuple ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerSpread ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:contextServices ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:layerChannels ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:lowering.visitProvideBlock ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:checkProvideBlocks ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:checkProvideProviders ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:mayCallProvide ` | ` admission:provide ` | ` 000-intro.md `, ` 900-appendices.md#ProvideStatement ` | ` support ` | Canonical callee screening preserves native call return inference before resolving provider overloads |
| ` vibelang/provide.go:effectProvideArguments ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providedCallType ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerCall ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/provide.go:providerQuickInfo ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement ` | ` support ` | VIP-12 providers |
| ` vibelang/regions.go:region.add ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:frame.lands ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:isJumpTarget ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitJumpTarget ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitJump ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.jumpTo ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.leave ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.transfer ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:jumpKind ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitTryStatement ` | ` admission:effect-try ` | ` - ` | ` pending ` | VIP-5 forbids Effect try statements; native TypeScript try remains valid |
| ` vibelang/regions.go:lowering.regionStatements ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.regionFunction ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitInFrame ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.runRegion ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.dispatch ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.runNow ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:canCompleteNormally ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:varList ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitVar ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.hoist ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitPlainThrowStatement ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.isNativeCatch ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:lowering.visitPlainCatchClause ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:init ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:checkFinallyJumps ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/regions.go:forEachJumpLeaving ` | ` admission:regions ` | ` 002-running.md ` | ` support ` | Control completion support; legacy Effect try paths below |
| ` vibelang/scopes_lower.go:newScopePlan ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:scopePlan.planScopes ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:scopePlan.planAcquisitionReference ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:isAcquisitionName ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:scopePlan.renamedAcquisitions ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitAcquisitionReference ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:scopePlan.planUsingDeclarations ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.usingCall ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:scopePlan.scoped ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitScoped ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.scopeName ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.scopeRegion ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:statementsOf ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitScopeBlock ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitScopeLoopBody ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.scopeBody ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitUsing ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.acquisition ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.initializerProgram ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.succeed ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitFork ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitUsingForOf ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.usingIteration ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/scopes_lower.go:lowering.visitUsingFor ` | ` admission:resource-scope ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/services_lower.go:newServicePlan ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:servicePlan.planServiceCall ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:servicePlan.planModuleKey ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:lowering.moduleKey ` | ` admission:implicit-service-call ` | ` - ` | ` pending ` | Denied VIP-10 and VIP-5; no implicit service/config execution |
| ` vibelang/services_lower.go:servicePlan.hasKey ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:servicePlan.planServiceNode ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:servicePlan.looksUp ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:analyzer.addServiceLookup ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:lowering.visitServiceLookup ` | ` admission:implicit-service-call ` | ` - ` | ` pending ` | Denied VIP-10 and VIP-5; no implicit service/config execution |
| ` vibelang/services_lower.go:lowering.visitModuleAlias ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` support ` | VIP-40: a top-level module declaration whose body is TypeScript, and identifier module specifiers |
| ` vibelang/services_lower.go:lowering.visitServiceClass ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/services_lower.go:operationArity ` | ` admission:services ` | ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-9 service class lowering; legacy lookup/call paths below |
| ` vibelang/trust_lower.go:newTrustedPlan ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:plan.planTrustedCalls ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:plan.unshadowedClass ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:analyzer.expectedFailures ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:analyzer.addFailures ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:analyzer.hasEscapingFailure ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:analyzer.forEachFailingCall ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.classReference ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.classAlias ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.namedImportDeclarations ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.visitTrustedCall ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.visitTrustedPlainCall ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.classArray ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.trustedThunk ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:lowering.arrow ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/trust_lower.go:containsYield ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:init ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:isTryCall ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:tryOperand ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:checkTries ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:checkTry ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:tryKeyword ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:triedText ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:checkTriedCall ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:retiredTryArguments ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:retiredTryRewrite ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:retiredTryMapper ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:hatchRan ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:isStableInput ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:runsWhereItStands ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/try.go:lowering.visitTry ` | ` admission:legacy-try ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:init ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:wireArgument.text ` | ` admission:wire ` | ` - ` | ` pending ` | Denied VIP-24: legacy wire provider rendering |
| ` vibelang/wire.go:isWireCall ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:isRuntimeExport ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:runtimeExportOf ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:packageNameOf ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:layerParts ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:unionMembers ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:wireArguments ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:fixedTupleElements ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:graphOfWire ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:findCycle ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:consumersFirst ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:checkWires ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:checkWire ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:neededFrom ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:servicePlan.planWire ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:lowering.visitWireCall ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:lowering.visitWireArguments ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:checkRunners ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:mainImported ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:bindsMain ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:checkTest ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:checkProgram ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:noteEntryLayers ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:runnerRequirements ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:services.wireNeeders ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` vibelang/wire.go:providedBy ` | ` admission:wire ` | ` - ` | ` pending ` | Legacy lowering has no accepted authority; census does not authorize its removal |
| ` parser/vibelang_catch.go:Parser.parseVibeLangCatchRest@catch-value ` | ` admission:catch-value ` | ` 900-appendices.md#CatchHandler `, ` 002-running.md ` | ` recovery ` | VIP-5: a value handler is parsed only to report EK0509 with its quick fix (4488a715) |
| ` parser/vibelang_effect.go:Parser.parseShorthandFunctionDeclaration@effect-shorthand ` | ` admission:effect-shorthand ` | ` 900-appendices.md#EffectShorthand ` | ` recovery ` | VIP-1: explicitly specified recovery for EK0101; not language admission |
| ` parser/vibelang.go:Parser.parseServiceDeclaration@control-declaration ` | ` admission:control-declaration ` | ` - ` | ` pending ` | Open VIP-35 does not admit control declarations |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangJoin@join-aggregate ` | ` admission:join-aggregate ` | ` - ` | ` pending ` | VIP-17 admits grammar operand but not aggregate Fiber join semantics |
| ` parser/vibelang_fibers.go:Parser.nextTokenStartsLegacyForkOperand ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` recovery ` | VIP-1/17: outside source Effect context, legacy fork operands are recognized only for their diagnostics and migration |
| ` parser/vibelang_fibers.go:Parser.legacyForkOwnerHasOperand ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` recovery ` | VIP-1/17: outside source Effect context, a named owner with an operand recovers for EK1701; a valid member access keeps its reading |
| ` parser/vibelang_fibers.go:Parser.nextTokenStartsLegacyJoinOperand ` | ` admission:join ` | ` 900-appendices.md#JoinExpression ` | ` recovery ` | VIP-1/17: outside source Effect context, legacy join operands are recognized only for their diagnostics and migration |
| ` parser/vibelang_fiber_context.go:Parser.setVibeLangFiberContext ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` support ` | Appendix A source Effect parameter for the reserved fork and join operators (VIP-1/17) |
| ` parser/vibelang_fiber_context.go:Parser.parseVibeLangOrdinaryInitializer ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` support ` | Appendix A source Effect parameter for the reserved fork and join operators (VIP-1/17) |
| ` parser/vibelang_execution_power.go:Parser.reportVibeLangExecutionPower ` | ` admission:execution-power ` | ` 900-appendices.md#TryExpression `, ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` recovery ` | EK0510: an unparenthesized try, fork or join left of ** is rejected; not language admission |
| ` vibelang/services_lower.go:lowering.visitServiceLookup@service-call ` | ` admission:service-call ` | ` - ` | ` pending ` | Denied VIP-10 implicit service member lookup |
| ` parser/vibelang_provide_newline.go:Parser.checkVibeLangProviderLineBreaks ` | ` admission:provide ` | ` 900-appendices.md#ProvideStatement `, ` 900-appendices.md#Provider ` | ` recovery ` | VIP-12: reports line breaks between provider list commas; not language admission |
| ` parser/vibelang_do.go:GetDoNarrowingOrigin ` | ` admission:do ` | ` 000-intro.md `, ` 002-running.md ` | ` support ` | VIP-2 / RC-38: retain the original short-circuit guard for TypeScript flow analysis without admitting additional syntax |
| ` parser/vibelang_do.go:Parser.checkDoBoundary ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` recovery ` | VIP-2: pinned TC39 do-expression static checks |
| ` parser/vibelang_do.go:Parser.checkDoEnds ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` recovery ` | VIP-2: pinned TC39 do-expression static checks |
| ` parser/vibelang_do.go:Parser.checkDoLoopHead ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` recovery ` | VIP-2: pinned TC39 do-expression static checks |
| ` parser/vibelang_do.go:Parser.checkDoParameterVar ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` recovery ` | VIP-2: pinned TC39 do-expression static checks |
| ` parser/vibelang_do.go:Parser.doError ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` recovery ` | VIP-2: pinned TC39 do-expression static checks |
| ` parser/vibelang_do.go:Parser.doForTryHeadJump ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` recovery ` | VIP-2: pinned TC39 do-expression static checks |
| ` parser/vibelang_do.go:Parser.doSite ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.mapperCompletion ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.mapperCompletionOf ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.parseVibeLangDos ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.prepareDoMatches ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.recordVibeLangDo ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.transparentFunctionOf ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:compoundOperator ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.assign ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.binary ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.callee ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.complete ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.completeList ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.completeSlot ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.conditional ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.declarations ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.expr ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.letStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.lift ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.lowerIn ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.ordered ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.properties ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.ref ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.reset ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.shortCircuit ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.slot ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.spill ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.statement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.statements ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.temp ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.undefined ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.variableStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:endsBadly ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:endsBadlyStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:forEachDoStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:hasLabel ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isAwaitLiteralOperation ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isBreakList ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isBreakStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isEmptyList ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isEmptyStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isIntrinsicCall ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isLoopChain ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isPureRead ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isSynthesizedArrow ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:IsVibeLangSynthesizedCall ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: a generated call takes the context of the position its form stands in |
| ` parser/vibelang_do.go:isTryOperation ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:isVibeLangCompletionMarker ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2/VIP-12: synthetic provider and interruption markers have empty source completion; introduces no additional syntax |
| ` parser/vibelang_do.go:jumpTargetWithin ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:keywordOf ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:VibeLangDoHeadBinding ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: maps a do lowering's generated loop-head cell back to its source ForDeclaration binding for checking; introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.loopHead ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: evaluates a do in a lexical for-in/of head in TC39 TDZ order (ForIn/OfHeadEvaluation); introduces no additional syntax |
| ` parser/vibelang_do.go:doLowering.forEachIsHome ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7: copies head cells into fresh item homes before source destructuring defaults without adding a callable boundary |
| ` parser/vibelang_do.go:setExpression ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:setStatement ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:setsCompletion ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:withoutEmpty ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_effect.go:Parser.isStartOfVibeLangEffectBlock ` | ` admission:effect-block ` | ` 900-appendices.md#EffectBlock ` | ` admitted ` | VIP-2: expression-position effect block; separated from the VIP-1 function entry point |
| ` parser/vibelang_effect.go:Parser.parseVibeLangEffectBlock ` | ` admission:effect-block ` | ` 900-appendices.md#EffectBlock ` | ` admitted ` | VIP-2: expression-position effect block; separated from the VIP-1 function entry point |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangFork@outside-effect ` | ` admission:fork-outside-effect ` | ` - ` | ` pending ` | VIP-1/17 requires Effect context; an unreachable legacy fork prefix currently reports only name/discard diagnostics |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangJoin@outside-effect ` | ` admission:join-outside-effect ` | ` - ` | ` pending ` | VIP-1/17 requires Effect context; a legacy join prefix in plain code currently reports only name and EK1704 operand diagnostics |
| ` parser/vibelang_fibers.go:Parser.isStartOfVibeLangJoin@fiber-binding ` | ` admission:fiber-binding ` | ` - ` | ` pending ` | VIP-17 (amended) reserves fork and join in Effect callable parameters (EK1702); parameter bindings are not checked |
| ` parser/vibelang_data.go:Parser.parseDataFields ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` support ` | VIP-16 data members; a missing member separator recovers as `EK1605` |
| ` parser/vibelang_data.go:dataMemberSeparatorDiagnostic ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration ` | ` recovery ` | VIP-16: `EK1605` reports a missing data member separator |
| ` parser/vibelang_default_data_export.go:Parser.parseVibeLangDefaultDataExport ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration `, ` 900-appendices.md#SchemaDeclaration ` | ` recovery ` | Chapter 006: export default schema and export default data are EK1501 and EK1603; read as named exports only to keep the module boundary |
| ` parser/vibelang_default_data_export.go:Parser.skipSchemaTypeParameters ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` recovery ` | Chapter 006: schema type parameters are EK1502; read only so the declaration causes no second error |
| ` parser/vibelang_default_data_export.go:Parser.vibelangDeclarationError ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration `, ` 900-appendices.md#SchemaDeclaration ` | ` recovery ` | Reports the Chapter 006 declaration syntax errors EK1501, EK1502 and EK1603 |
| ` parser/vibelang_match.go:Parser.markUncovered ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 / Chapter 004 Coverage: `and` and `not` arms cover nothing (`EK4701`); flags their tests for the checker |
| ` parser/vibelang_match.go:bindsBesideOneTest ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 / Chapter 004 Coverage: recognize binding-only operands without granting `and` exhaustive coverage |
| ` parser/vibelang_match.go:onlyBinds ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 / Chapter 004 Coverage: recognize patterns that only bind and test key presence |
| ` parser/vibelang_match_cache.go:Parser.matchCacheCall ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:Parser.matchCacheStatements ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:Parser.newMatchCacheName ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:VibeLangMatchCacheBindings ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:VibeLangMatchCacheCondition ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:VibeLangMatchCacheDeclaration ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:VibeLangMatchCacheFinish ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` parser/vibelang_match_cache.go:patternUsesIterator ` | ` admission:match ` | ` 004-match.md `, ` 008-runtime.md ` | ` support ` | VIP-7/31: private per-evaluation iterator caches and native completion cleanup preserve Effect abandonment |
| ` vibelang/lower.go:bodyStatements ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | VIP-1: callable body helper relocated from retired plain-function lowering |
| ` vibelang/trust_lower.go:inCatchingTry ` | ` admission:trusted ` | ` - ` | ` pending ` | Legacy trusted-exception hatch catch-context helper; no accepted VIP grants the trusted API |
| ` parser/vibelang_do.go:Parser.completionSite ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: completion temporary retains the contextual type of the source do-expression site |
| ` parser/vibelang_do.go:anonymousDoValue ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: identify anonymous source values so a do temporary does not infer a new native name |
| ` parser/vibelang_do.go:doLowering.finish ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: finish an earlier operand or spread before the following do expression runs |
| ` parser/vibelang_do.go:doLowering.method ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: preserve a member callee and its receiver before a later do expression |
| ` parser/vibelang_do.go:doLowering.orderedWith ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: finish do-bearing operands in native source evaluation order |
| ` parser/vibelang_do.go:doLowering.propertyKey ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: finish a computed property key and its native conversion before later do work |
| ` parser/vibelang_do.go:doLowering.stringify ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: preserve native template substitution conversion before a later do expression |
| ` parser/vibelang_do.go:doLowering.template ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: lower template substitutions in source order without adding an execution boundary |
| ` parser/vibelang_do.go:Parser.valueOnly ` | ` admission:names ` | ` 001-functions.md `, ` 002-running.md ` | ` support ` | RC-33: suppress private capture names before anonymous function or class creation |
| ` parser/vibelang_do.go:doLowering.valueOnly ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: preserve value-only completion and source anonymous names across do temporaries |
| ` parser/vibelang_do.go:isMemberCallee ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: recognize native member callees for receiver-preserving do lowering |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangFork@block ` | ` admission:fork-block ` | ` - ` | ` pending ` | VIP-17 requires a UnaryExpression operand; legacy bare brace bodies are wrapped in program arrows without adopted bare-block authority |
| ` vibelang/producers.go:producerAnnotation ` | ` admission:producer ` | ` 900-appendices.md#Producer `, ` 900-appendices.md#ReturnType `, ` 002-running.md ` | ` support ` | VIP-21: check a written Stream return annotation against the producer generator channels without changing its public Stream signature |
| ` parser/vibelang.go:Parser.isStartOfVibeLangSlot ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | VIP-3 and detail211: slot starts exclude parser-only JSDoc forms and preserve optional tuple syntax |
| ` parser/vibelang.go:Parser.nextIsDanglingVibeLangBang ` | ` admission:effect-type ` | ` 900-appendices.md#EffectType `, ` 001-functions.md ` | ` recovery ` | VIP-3: a lone trailing bang or a slot starting on another line is native postfix-type syntax rejected with TS17019 |
| ` parser/vibelang.go:Parser.parseSchemaDeclaration@schema-type-parameters ` | ` admission:schema-type-parameters ` | ` 006-data.md `, ` 900-appendices.md#SchemaDeclaration ` | ` recovery ` | VIP-15: forbidden schema type parameters recover the header and report EK1502 before the body or alias |
| ` parser/vibelang_fibers.go:Parser.isVibeLangConcurrentFor@for-concurrent-line-break ` | ` admission:for-concurrent-line-break ` | ` - ` | ` pending ` | Appendix A: `concurrent` is a keyword only before `(` on the same line; a line break after `concurrent` still compiles as the loop |
| ` parser/vibelang_effect.go:Parser.isStartOfVibeLangEffectTypeMember@schema-effect-field ` | ` admission:schema-effect-field ` | ` - ` | ` pending ` | VIP-1: a schema field written with effect compiles with no diagnostic; SchemaDeclaration's Field has no modifier, and EK0108 rejects the same member in a type literal |
| ` parser/vibelang_default_error_export.go:Parser.isVibeLangDefaultNamedExport ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration `, ` 900-appendices.md#ServiceDeclaration `, ` 003-failures.md `, ` 005-services.md `, ` 900-appendices.md#SchemaDeclaration `, ` 900-appendices.md#DataDeclaration `, ` 006-data.md ` | ` recovery ` | VIP-13/9/15/16 and native ExportDeclaration: recover default named custom declarations with EK1305/EK0905/EK1501/EK1603 |
| ` parser/vibelang_default_error_export.go:Parser.parseVibeLangDefaultErrorExport ` | ` admission:error ` | ` 900-appendices.md#ErrorDeclaration `, ` 900-appendices.md#ServiceDeclaration `, ` 003-failures.md `, ` 005-services.md `, ` 900-appendices.md#SchemaDeclaration `, ` 900-appendices.md#DataDeclaration `, ` 006-data.md ` | ` recovery ` | VIP-13/9/15/16 and native ExportDeclaration: recover default named custom declarations with EK1305/EK0905/EK1501/EK1603 |
| ` parser/vibelang_data.go:dataPayloadTypeScript ` | ` admission:data ` | ` 900-appendices.md#DataDeclaration `, ` 006-data.md ` | ` support ` | VIP-16: TaggedEnum owns variant-field readonlyness; nested payload types preserve written TypeScript mutability |
| ` parser/vibelang_schema_generic.go:Parser.attachVibeLangSchemaGenericScopes ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15: mapped Array/ReadonlyArray/Record/Readonly references preserve resolved library bindings, codec flags and ordinary shadowing |
| ` parser/vibelang_schema_generic.go:Parser.vibelangArraySchemaReference ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15: mapped Array/ReadonlyArray/Record/Readonly references preserve resolved library bindings, codec flags and ordinary shadowing |
| ` parser/vibelang_schema_generic.go:Parser.vibelangReadonlyRecordReference ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15: mapped Array/ReadonlyArray/Record/Readonly references preserve resolved library bindings, codec flags and ordinary shadowing |
| ` parser/vibelang_schema_generic.go:Parser.vibelangRecordSchemaReference ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15: mapped Array/ReadonlyArray/Record/Readonly references preserve resolved library bindings, codec flags and ordinary shadowing |
| ` parser/vibelang_schema_generic.go:Parser.vibelangSchemaGenericName ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15: mapped Array/ReadonlyArray/Record/Readonly references preserve resolved library bindings, codec flags and ordinary shadowing |
| ` parser/vibelang_syntax.go:vibeLangScriptKind ` | ` admission:syntax-records ` | ` 900-appendices.md ` | ` support ` | VIP-39: a .vibex file reads the same VibeLang productions with TypeScript JSX; the script-kind choice admits no form |
| ` parser/vibelang_errors.go:vibelangErrorPayloadSeparators ` | ` admission:error ` | ` 900-appendices.md#Separator `, ` 900-appendices.md#Field `, ` 003-failures.md ` | ` support ` | VIP-13: a comma after a payload Field is the Separator production; the parser marks it for the projected class without admitting class punctuation |
| ` parser/vibelang_modules.go:Parser.isStartOfVibeLangModuleExpression ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` recovery ` | VIP-40: EK4002 and EK4003 in an expression only where module cannot be the identifier operand of as, satisfies, is or of |
| ` parser/vibelang_modules.go:Parser.rejectVibeLangModule ` | ` admission:module-declaration ` | ` 900-appendices.md#ModuleDeclaration ` | ` recovery ` | VIP-40: EK4001-EK4003 reject a module declaration below the top level, an exported one and a nameless module expression |
| ` parser/vibelang_effect.go:Parser.tryParseVibeLangRestrictedEffectMember ` | ` admission:effect-restricted-members ` | ` 001-functions.md ` | ` recovery ` | VIP-1: recover forbidden effect accessor/constructor prefixes as native nodes solely to report EK0104 |
| ` vibelang/services_lower.go:serviceHead ` | ` admission:services ` | ` 900-appendices.md#CatchExpression `, ` 005-services.md ` | ` support ` | VIP-5 and VIP-9: a plain catch head that looks a service up suspends the lookup; the lowering admits no form |
| ` vibelang/services_lower.go:lowering.visitServiceHead ` | ` admission:services ` | ` 900-appendices.md#CatchExpression `, ` 005-services.md ` | ` support ` | VIP-5 and VIP-9: a plain catch head that looks a service up suspends the lookup; the lowering admits no form |
| ` parser/vibelang_fiber_context.go:Parser.isReservedFiberName ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` support ` | VIP-17 (amended): EK1702 rejects fork and join as bindings under [+Effect] |
| ` parser/vibelang_fiber_context.go:Parser.rejectReservedFiberName ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` support ` | VIP-17 (amended): EK1702 rejects fork and join as bindings under [+Effect] |
| ` parser/vibelang_fiber_context.go:Parser.nextTokenIsEqualsGreaterThan ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` support ` | VIP-17 (amended): EK1702 rejects fork and join as bindings under [+Effect] |
| ` parser/vibelang_fiber_context.go:Parser.nextTokenIsColonToken ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` support ` | VIP-17 (amended): EK1702 rejects fork and join as bindings under [+Effect] |
| ` parser/vibelang.go:Parser.parseSchemaDeclaration@schema-no-body ` | ` admission:schema-no-body ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` recovery ` | A schema header without a field body or alias reports `EK1503`; the saved witness remains a rejection control |
| ` parser/vibelang_errors.go:Parser.parseErrorDeclaration@error-no-end ` | ` admission:error-no-end ` | ` - ` | ` pending ` | Appendix A: a bodyless error or schema error ends as a TypeScript statement; `error E effect { }` starts another expression on the same line |
| ` parser/vibelang.go:Parser.parseVibeLangEffectType@effect-type-line-break ` | ` admission:effect-type-line-break ` | ` - ` | ` pending ` | Appendix A: EffectType has [no LineTerminator here] between its bangs; `number !` then `!` on the next line compiles as `number!!` |
| ` parser/vibelang_primitives.go:Parser.isStartOfVibeLangMaskBlock@interruption-outside-effect ` | ` admission:interruption-outside-effect ` | ` 900-appendices.md#Uninterruptible `, ` 900-appendices.md#Restore `, ` 900-appendices.md#Interruptible `, ` 002-running.md ` | ` recovery ` | VIP-22/EK2201: recognizes outside-Effect interruption blocks only to reject their placement; no admitted syntax |
| ` vibelang/frames_lower.go:lowering.bindSuperMethod ` | ` admission:effect-function-support ` | ` 001-functions.md ` | ` support ` | VIP-1 Bindings: preserves the receiver of a super method or tag without reading its own call property; no new syntax |
| ` parser/vibelang_match.go:Parser.inlineBinding ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: a name bound inside or and not patterns shares one cell |
| ` parser/vibelang_schema_type_parameters.go:Parser.parseVibeLangSchemaTypeParameters ` | ` admission:schema-type-parameters ` | ` 006-data.md `, ` 900-appendices.md#SchemaDeclaration ` | ` recovery ` | VIP-15: consume a forbidden generic schema header and anchor its preserving empty-body repair |
| ` vibelang/producers.go:isProducer@interruption-in-generator ` | ` admission:interruption-in-generator ` | ` - ` | ` pending ` | VIP-1/21/22 require an effect marker: the legacy unannotated native-generator producer predicate admits interruption blocks in a plain callable |
| ` vibelang/producers.go:isProducer@fiber-in-generator ` | ` admission:fiber-in-generator ` | ` 900-appendices.md#ForkExpression `, ` 900-appendices.md#JoinExpression ` | ` recovery ` | VIP-17: native plain-generator `fork` and `join` retain syntax rejection; the original operand-type-only witness remains a regression control |
| ` parser/vibelang.go:Parser.parseServiceDeclaration@service-class ` | ` admission:service-class ` | ` 005-services.md `, ` 900-appendices.md ` | ` recovery ` | VIP-9 has no class token in ServiceStart; EK0909 rejects the retired spelling and retains its preserving migration |
| ` parser/vibelang.go:Parser.parseVibeLangProvideStatement@provider-expression ` | ` admission:provider-expression ` | ` - ` | ` pending ` | Appendix A: Provider = LeftHandSideExpression "=" AssignmentExpression \| ConditionalExpression; `provide K => 1 { }` has no derivation and reports only old EK3207 |
| ` parser/vibelang.go:Parser.parseVibeLangEffectType@effect-type-trailing-bang ` | ` admission:effect-type-trailing-bang ` | ` - ` | ` pending ` | VIP-3 and Appendix A: EffectType ends in an operand or the omitted-E `!!`; `type T = A!B!;` compiles with no diagnostic instead of reporting a dangling `!` |
| ` parser/vibelang_errors.go:Parser.isVibeLangNoSeparator ` | ` admission:error ` | ` 900-appendices.md#ErrorBody `, ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-13/29/9: recover a missing member Separator for EK1306/EK0908; native class parsing stays separate |
| ` parser/vibelang_errors.go:Parser.parseVibeLangNoSeparator ` | ` admission:error ` | ` 900-appendices.md#ErrorBody `, ` 900-appendices.md#ServiceDeclaration ` | ` support ` | VIP-13/29/9: recover a missing member Separator for EK1306/EK0908; native class parsing stays separate |
| ` parser/vibelang_effect_channels.go:Parser.checkVibeLangEffectChannels ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | VIP-3 EK0301 syntax validation also under --noCheck; does not admit bare compound slots |
| ` parser/vibelang_effect_channels.go:Parser.parseVibeLangConditionalCheck ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` recovery ` | VIP-3 EK0301 recovers the conditional check only to diagnose and preserve its grouping |
| ` parser/vibelang_effect_channels.go:VibeLangEffectChannelParts ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | VIP-3 EK0301 identifies written Effect operands needing parentheses for diagnostics and the preserving fix |
| ` parser/vibelang.go:Parser.isVibeLangServiceCallSignature ` | ` admission:service ` | ` 900-appendices.md#ServiceDeclaration ` | ` recovery ` | VIP-9 recovers a forbidden call signature for EK0902; it is not an admitted service member |
| ` parser/vibelang_service_syntax.go:Parser.vibelangServiceError ` | ` admission:service ` | ` 900-appendices.md#ServiceDeclaration `, ` 005-services.md ` | ` support ` | VIP-9: shared EK0906/EK0907/EK0908 parser diagnostic writer; it admits no declaration form |
| ` parser/vibelang_service_syntax.go:Parser.isVibeLangAmbientService ` | ` admission:service ` | ` 900-appendices.md#ServiceDeclaration `, ` 005-services.md ` | ` support ` | VIP-9: explicit or inherited native ambient context rejects a custom service with EK0907; ordinary ambient TypeScript stays native |
| ` parser/vibelang_do.go:Parser.loopHeadOf ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: pinned TC39 do-expression lowering and completion support; introduces no additional syntax |
| ` parser/vibelang_do.go:Parser.isDoArrow ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2 / RC-32: identify transparent do arrows for source early errors; introduces no additional syntax |
| ` parser/vibelang_do.go:forEachDoStatementThrough ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2 / RC-32: traverse nested do blocks for early errors while stopping at source functions and classes |
| ` parser/vibelang_do.go:Parser.doOfArrow ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2 / RC-32: distinguish source do owners from transparent native match wrappers for early errors |
| ` vibelang/try.go:assignsOrCaptures ` | ` admission:legacy-try ` | ` 007-tooling.md ` | ` support ` | Codemod preserves an assigned or captured parameter cell, including a same-name input |
| ` vibelang/try.go:evaluatedThunk ` | ` admission:legacy-try ` | ` 007-tooling.md ` | ` support ` | Codemod evaluates every input once in source order before rebinding parameters |
| ` vibelang/try.go:freshName ` | ` admission:legacy-try ` | ` 007-tooling.md ` | ` support ` | Codemod avoids captures when introducing a temporary for an input |
| ` vibelang/try.go:inlinedThunk ` | ` admission:legacy-try ` | ` 007-tooling.md ` | ` support ` | Retired hatch migration preserves the callback body and its parameter bindings |
| ` vibelang/try.go:isPlainValueInput ` | ` admission:legacy-try ` | ` 007-tooling.md ` | ` support ` | Codemod inlines only inputs whose evaluation and binding semantics are preserved |
| ` parser/vibelang_data.go:Parser.parseDataDeclaration@data-separators ` | ` admission:data-separators ` | ` - ` | ` pending ` | Appendix A: DataDeclaration has one Separator between variants and an optional last one; `data D { A; ; B }` and `data D { ; A }` compile |
| ` parser/vibelang_try.go:Parser.isStartOfVibeLangTry@try-in-generator ` | ` admission:try-in-generator ` | ` - ` | ` pending ` | VIP-5 and Appendix B EK0501: `try` outside effect code is an error; in a plain generator it reports only the operand error EK0502 |
| ` parser/vibelang_fibers.go:Parser.parseVibeLangJoin@join-for-head ` | ` admission:join-for-head ` | ` 900-appendices.md#JoinExpression `, ` 002-running.md ` | ` recovery ` | VIP-17: a `join` expression cannot be the for-of assignment target; native `TS2487` is retained beside operand diagnostics |
| ` parser/vibelang.go:Parser.parseServiceDeclaration@service-separators ` | ` admission:service-separators ` | ` - ` | ` pending ` | Appendix A: ServiceDeclaration has one Separator after each member, as interface members; `service S { n: number; ; m: string }` compiles |
| ` parser/vibelang_match.go:misplacedRest ` | ` admission:match ` | ` 004-match.md ` | ` recovery ` | VIP-7: EK0707, a rest element or property that is not last |
| ` parser/vibelang.go:schemaWrittenReadonly ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration ` | ` support ` | VIP-15 key mutability: a field is readonly only when written readonly |
| ` parser/vibelang_match.go:Parser.isVibeLangSymbolCustomMatcher ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: Symbol.customMatcher spelled through the global Symbol |
| ` parser/vibelang_effect.go:Parser.consumeVibeLangEffectWord ` | ` admission:effect ` | ` 001-functions.md ` | ` support ` | VIP-39: consume the literal effect modifier and retain native TS1260 for Unicode escapes; lexical validation, not a new admitted form |
| ` parser/vibelang_blocks.go:Parser.parseVibeLangThrow ` | ` admission:throw-expression ` | ` 900-appendices.md ` | ` support ` | VIP-41 unary operand, invalid-punctuator lookahead and automatic semicolon insertion support |
| ` parser/vibelang_throw_lookahead.go:ThrowLookaheadMessage ` | ` admission:throw-expression ` | ` 900-appendices.md ` | ` support ` | VIP-41 unary operand, invalid-punctuator lookahead and automatic semicolon insertion support |
| ` parser/vibelang_throw_lookahead.go:isThrowExpressionInvalidPunctuator ` | ` admission:throw-expression ` | ` 900-appendices.md ` | ` support ` | VIP-41 unary operand, invalid-punctuator lookahead and automatic semicolon insertion support |
| ` parser/vibelang_throw_lookahead.go:throwInvalidPunctuatorCanFollowASI ` | ` admission:throw-expression ` | ` 900-appendices.md ` | ` support ` | VIP-41 unary operand, invalid-punctuator lookahead and automatic semicolon insertion support |
| ` parser/vibelang_throw_lookahead.go:Parser.checkVibeLangThrowLookahead ` | ` admission:throw-expression ` | ` 900-appendices.md `, ` 003-failures.md ` | ` support ` | VIP-41 rejects every invalid punctuator, including comma separators; the preserving quick fix groups the whole throw expression. |
| ` parser/vibelang_throw_lookahead.go:Parser.atVibeLangThrowStop ` | ` admission:throw-expression ` | ` 900-appendices.md ` | ` support ` | VIP-41 unary operand, invalid-punctuator lookahead and automatic semicolon insertion support |
| ` parser/vibelang_throw_lookahead.go:Parser.reportVibeLangThrowStop ` | ` admission:throw-expression ` | ` 900-appendices.md ` | ` support ` | VIP-41 unary operand, invalid-punctuator lookahead and automatic semicolon insertion support |
| ` parser/vibelang_match.go:Parser.parseMatchRelationOperand ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: relational patterns of the pinned TC39 snapshot, such as < 0 |
| ` parser/vibelang_match.go:Parser.relationTest ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: relational patterns of the pinned TC39 snapshot, such as < 0 |
| ` parser/vibelang_catch_precedence.go:Parser.reportVibeLangCatchPrecedence ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 900-appendices.md#CatchHandler `, ` 002-running.md ` | ` recovery ` | VIP-5/detail 247: Report EK0512 while retaining the legacy tree for a preserving migration |
| ` parser/vibelang_catch_precedence.go:vibeLangCatchMixedHead ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 900-appendices.md#CatchHandler `, ` 002-running.md ` | ` recovery ` | VIP-5/detail 247: Reject logical/coalesce operators in an unparenthesized CatchHead; stop at expression boundaries |
| ` parser/vibelang_catch_precedence.go:IsVibeLangCatchHandlerContinuation ` | ` admission:catch ` | ` 900-appendices.md#CatchExpression `, ` 900-appendices.md#CatchHandler `, ` 002-running.md ` | ` recovery ` | VIP-5/detail 247: Recognize forbidden closed-handler continuations for EK0512 and suppress duplicate EK0509 |
| ` parser/vibelang_schema_optional.go:Parser.vibelangOptionalSchema ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15 optional mapping: retain source optional types and explicit undefined unions for the TypeScript-configured compatibility upgrade |
| ` parser/vibelang_schema_optional.go:Parser.vibelangOptionalSchemaType ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15 optional mapping: normalize explicit undefined union arms through the optional wrapper while preserving the underlying codec type |
| ` parser/vibelang_schema_optional.go:schemaTypeAllowsUndefined ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` support ` | VIP-15 optional mapping: retain source optional types and explicit undefined unions for the TypeScript-configured compatibility upgrade |
| ` vibelang/hatches.go:boundaryOperands ` | ` admission:hatches ` | ` - ` | ` pending ` | Extracts operands for legacy hatch boundary wrappers; no accepted hatch syntax authority |
| ` parser/vibelang_effect_slot_relational.go:Parser.nextVibeLangRequirementIsComparison ` | ` admission:effect-type ` | ` 900-appendices.md#EffectType `, ` 001-functions.md ` | ` support ` | VIP-3: distinguishes an ordinary comparison from a requirement slot; no new syntax |
| ` vibelang/effect_parameters_lower.go:lowering.callTimeEffectBody ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 003-failures.md ` | ` support ` | VIP-1: binds parameters once at the call and keeps only the source body inside the generator |
| ` vibelang/effect_parameters_lower.go:lowering.directFunctionBody ` | ` admission:effect-function-support ` | ` 001-functions.md ` | ` support ` | VIP-1: preserves the source callable kind, name, arguments and frame while constructing its body |
| ` vibelang/effect_parameters_lower.go:lowering.effectBindingBoundary ` | ` admission:effect-function-support ` | ` 001-functions.md `, ` 003-failures.md ` | ` support ` | VIP-1/4: call-time binding failures become defects in the returned Effect; no new syntax |
| ` parser/vibelang_effect_channels.go:vibeLangFunctionTypeIsMissingArrow ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | VIP-3: identify a closed recovered function-type head lacking its outer arrow; ordinary invalid operands keep native syntax diagnostics |
| ` parser/vibelang_do.go:doConcurrentBody ` | ` admission:do ` | ` 900-appendices.md `, ` 002-running.md ` | ` support ` | VIP-2: recover the source ForConcurrent body for the native iteration completion predicates |
| ` parser/vibelang_data.go:Parser.skipDataVariantParameters ` | ` admission:data ` | ` 900-appendices.md#Variant ` | ` recovery ` | VIP-16/detail 247: consume a malformed parenthesized payload for EK1606; retain the declaration boundary |
| ` parser/vibelang_effect_assertion.go:Parser.withVibeLangExpressionASI ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_effect_assertion.go:Parser.parseVibeLangExpressionAllowInASI ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_effect_assertion.go:Parser.parseVibeLangExpressionInitializer ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_effect_assertion.go:Parser.parseVibeLangClassInitializer ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_effect_assertion.go:Parser.optionalVibeLangRequirementKeyword ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_effect_assertion.go:Parser.parseVibeLangAssertionType ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_effect_assertion.go:Parser.vibeLangAssertionRestComplete ` | ` admission:effect-type ` | ` 900-appendices.md#EffectOperand ` | ` support ` | Optional requirement complete-parse priority and the native expression caller’s ASI boundary |
| ` parser/vibelang_catch.go:Parser.parseVibeLangCatchHandlerWorker ` | ` admission:catch-handler-recovery ` | ` 900-appendices.md#CatchHandler `, ` 002-running.md ` | ` support ` | VIP-5: parse the literal handler before reassigning only its missing-arrow diagnostic to EK0509 |
| ` vibelang/match_receiver.go:lowering.visitPatternReceiver ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7: retain a member pattern reference receiver while leaving checked pattern calls intact |
| ` parser/vibelang_do_bindings.go:isOmittedBindingElement ` | ` admission:do ` | ` 002-running.md ` | ` support ` | Recognizes an array pattern hole in lowered bindings; no additional syntax |
| ` parser/vibelang_do_bindings.go:Parser.doBindingPattern ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: find flat array and object defaults whose jumps must leave the enclosing activation |
| ` parser/vibelang_do_bindings.go:VibeLangDoBindingContext ` | ` admission:do ` | ` 000-intro.md `, ` 002-running.md ` | ` support ` | VIP-2: retain native binding context independently of generated temporaries |
| ` parser/vibelang_do_bindings.go:VibeLangDoBindingNormalContext ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: outward paths supply no normal completion value |
| ` parser/vibelang_do_bindings.go:VibeLangDoBindingRead ` | ` admission:do ` | ` 000-intro.md `, ` 002-running.md ` | ` support ` | VIP-2: attach native binding types and tuple bounds to generated reads |
| ` parser/vibelang_do_bindings.go:VibeLangDoBindingReads ` | ` admission:do ` | ` 000-intro.md `, ` 002-running.md ` | ` support ` | VIP-2: retain written default constraints for native assignability checks |
| ` parser/vibelang_do_bindings.go:doLowering.bindingStatement ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: guarded defaults preserve native evaluation order and source jumps |
| ` parser/vibelang_do_bindings.go:doLowering.bindingPropertyRead ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: read an object element once, typed as the native element |
| ` parser/vibelang_do_bindings.go:doLowering.bindingKey ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: copy an object element name for its generated reads |
| ` parser/vibelang_do_bindings.go:doLowering.bindingDefault ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: lower a default that runs only for undefined |
| ` parser/vibelang_do_bindings.go:doLowering.finishBindingDefaults ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: keep the native pattern types of lowered defaults |
| ` parser/vibelang_do_bindings.go:doLowering.bindingDefaultContextSite ` | ` admission:do ` | ` 000-intro.md `, ` 002-running.md ` | ` support ` | VIP-2: contextual typing reaches the normal default result only |
| ` parser/vibelang_do_bindings.go:doLowering.bindingTypingPattern ` | ` admission:do ` | ` 000-intro.md `, ` 002-running.md ` | ` support ` | VIP-2: source binding context controls literal, tuple and declaration types |
| ` parser/vibelang_do_bindings.go:doLowering.finishArrayBindings ` | ` admission:do ` | ` 002-running.md ` | ` support ` | VIP-2: unfinished iterators close with native jump and throw precedence while lexical cells are retained |
| ` parser/vibelang_match.go:patternHasCoverageCombinator ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 004-match.md ` | ` support ` | VIP-7 and/not subpatterns cannot establish finite coverage through a containing pattern |
| ` parser/vibelang_effect.go:Parser.scanEffectPrefix ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier ` | ` support ` | VIP-1/VIP-2: recover either mixed prefix order for EK0105 without changing ordinary async names or line breaks |
| ` parser/vibelang_effect.go:Parser.reportEffectAsyncConflict ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier ` | ` support ` | VIP-1/VIP-2: recover either mixed prefix order for EK0105 without changing ordinary async names or line breaks |
| ` parser/vibelang_effect.go:Parser.parseEffectPrefix ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier ` | ` support ` | VIP-1/VIP-2: recover either mixed prefix order for EK0105 without changing ordinary async names or line breaks |
| ` parser/vibelang_effect.go:Parser.reportEffectAsyncModifiers ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier ` | ` support ` | VIP-1/VIP-2: recover either mixed prefix order for EK0105 without changing ordinary async names or line breaks |
| ` parser/vibelang_effect.go:Parser.isStartOfMixedEffectArrow ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier `, ` 001-functions.md ` | ` recovery ` | VIP-1: a complete mixed arrow at a statement start remains an expression and reports EK0105 rather than shorthand-declaration syntax errors |
| ` parser/vibelang_effect.go:Parser.parseEffectAccessor ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier `, ` 001-functions.md ` | ` recovery ` | VIP-1: recover forbidden mixed accessors as native accessor nodes for EK0104 and EK0105 |
| ` parser/vibelang_effect.go:Parser.isStartOfMixedEffectAccessor ` | ` admission:effect ` | ` 900-appendices.md#EffectModifier `, ` 001-functions.md ` | ` recovery ` | VIP-1: mixed accessor lookahead reports EK0104 and EK0105 without changing pure accessor admission |
| ` vibelang/is_binding_tdz.go:plan.planIsBindingTDZ ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: resolve lexical is binding references without changing TypeScript assignment flow |
| ` vibelang/is_binding_tdz.go:lowering.visitIsBindingDeclaration ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: retain an uninitialized scalar until the binding pattern executes |
| ` vibelang/is_binding_tdz.go:lowering.visitIsBindingReference ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: preserve runtime TDZ, source writes and native GetValue/PutValue order |
| ` vibelang/is_binding_tdz.go:lowering.visitIsBindingShorthand ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: preserve runtime TDZ in object shorthand reads and assignment defaults |
| ` vibelang/is_binding_tdz.go:lowering.isBindingSentinel ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: keep TDZ identity private so every source value can initialize a binding |
| ` parser/vibelang_match_members.go:MatchMemberArms ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 per-member and literal-case exhaustiveness projection; no new syntax |
| ` parser/vibelang_match_members.go:memberCoverageArm ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 per-member and literal-case exhaustiveness projection; no new syntax |
| ` parser/vibelang_match_members.go:Parser.recordMatchMemberArms ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 per-member and literal-case exhaustiveness projection; no new syntax |
| ` parser/vibelang_match_members.go:Parser.attachMatchMemberArms ` | ` admission:match ` | ` 900-appendices.md#MatchExpression ` | ` support ` | VIP-7 per-member and literal-case exhaustiveness projection; no new syntax |
| ` vibelang/object_member_context_lower.go:lowering.visitObjectMemberName ` | ` admission:effect ` | ` 001-functions.md ` | ` support ` | VIP-1/001: an object Effect method keeps the enclosing context for its computed name after its body is lowered |
| ` vibelang/object_member_context_lower.go:lowering.visitObjectMemberBoundary ` | ` admission:effect ` | ` 001-functions.md ` | ` support ` | VIP-1/001: object method and accessor computed names evaluate in the enclosing activation; their bodies retain their own context |
| ` parser/vibelang_match.go:Parser.isStartOfVibeLangAsyncMatch ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:Parser.scanStartOfVibeLangAsyncMatch ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:Parser.parseVibeLangAsyncMatch ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:Parser.parseVibeLangMatchWith ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:Parser.checkVibeLangAsyncMatchJumps ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:asyncMatchHasOuterTarget ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:Parser.recordVibeLangSourceReturn ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_match.go:VibeLangAsyncMatches ` | ` admission:match ` | ` 900-appendices.md#AsyncMatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: async match creates a native async function boundary; await and source-jump checks preserve that boundary |
| ` parser/vibelang_yield_activation.go:VibeLangYieldOutsideProducer ` | ` admission:producer-yield-activation ` | ` 900-appendices.md#Producer `, ` 002-running.md ` | ` recovery ` | VIP-21: source activations and formal initialization own EK2104; compiler-generated wrappers grant no yield permission |
| ` parser/vibelang_declaration_body.go:Parser.reportVibeLangMissingBody ` | ` admission:schema ` | ` 900-appendices.md#SchemaDeclaration `, ` 006-data.md ` | ` recovery ` | Reports `EK1503` for a schema header without the required field body or alias; recovery adds no form |
| ` parser/vibelang_fibers.go:Parser.rewriteConcurrentLabelContinues ` | ` admission:for-concurrent ` | ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19 self-labeled `continue` ends the current item, preserving source callable boundaries |
| ` parser/vibelang.go:Parser.vibelangSchemaFields@schema-async-field ` | ` admission:schema-async-field ` | ` - ` | ` pending ` | VIP-15: an unresolved schema field reference reports `EK2109` and covers the declaration, hiding native `async` modifier rejection |
| ` parser/vibelang.go:Parser.vibelangSchemaFields@schema-static-field ` | ` admission:schema-static-field ` | ` - ` | ` pending ` | VIP-15: an unresolved `static` schema field reports `EK2109` and covers the declaration, hiding the modifier rejection; `Field` admits only `readonly` |
| ` parser/vibelang.go:Parser.vibelangSchemaFields@schema-duplicate-readonly ` | ` admission:schema-duplicate-readonly ` | ` - ` | ` pending ` | VIP-15: a repeated `readonly` on an unresolved schema field reports `EK2109` and covers the declaration, hiding native `TS1030`; `Field` admits one `readonly` |
| ` parser/vibelang.go:Parser.vibelangSchemaFields@schema-readonly-method ` | ` admission:schema-readonly-method ` | ` - ` | ` pending ` | VIP-15: a `readonly` method signature in a schema object-type alias reports `EK2109` and covers native `TS1024`; `Field` is a property |
| ` parser/vibelang_do.go:Parser.hasYieldingMatch ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 002-running.md ` | ` support ` | VIP-7 and VIP-2: identify a match whose arm yields into its enclosing source generator |
| ` parser/vibelang_do.go:Parser.matchArmsYield ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 002-running.md ` | ` support ` | VIP-7 preserves the enclosing activation of yielding matches; only live expression calls require lifting |
| ` parser/vibelang_match.go:coveragePattern ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 004-match.md ` | ` support ` | VIP-7: remove irrefutable captures only from coverage analysis while preserving source pattern evaluation |
| ` parser/vibelang_match.go:Parser.mExtractCall ` | ` admission:match ` | ` 900-appendices.md#MatchExpression `, ` 900-appendices.md#RegularExpressionPattern `, ` 004-match.md ` | ` support ` | VIP-7: emit the existing extractor call and preserve the global regular-expression literal flag for its extraction type |
| ` parser/vibelang_modules.go:Parser.vibelangModuleReference@keyword ` | ` admission:module-specifier-keyword ` | ` - ` | ` pending ` | VIP-40: a strict reserved word is retained as an identifier module specifier with only module-name diagnostics |
| ` parser/vibelang_match.go:Parser.bindsIs ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: locate condition bindings outside nested callable and class homes |
| ` parser/vibelang_match.go:Parser.restructureVibeLangDo ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: give `do…while` conditions fresh loop-head binding cells |
| ` vibelang/is_binding_tdz.go:lowering.resetIsBindingIteration ` | ` admission:is-binding-tdz ` | ` 004-match.md ` | ` support ` | VIP-7: reset `test` and `update` bindings after native environment copying |
| ` parser/vibelang_fibers.go:Parser.concurrentHeadEnvironment ` | ` admission:for-concurrent ` | ` 002-running.md `, ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19: retain uninitialized RHS head cells and evaluate a written limit before their environment; introduces no additional syntax |
| ` parser/vibelang_fibers.go:VibeLangConcurrentCall ` | ` admission:for-concurrent ` | ` 002-running.md `, ` 900-appendices.md#ForConcurrent ` | ` support ` | VIP-19: recognize a source loop through generated head environments without treating ordinary source blocks as loops |
| ` parser/vibelang_match_cache.go:MatchPropertyCaches ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: retain per-evaluation property observations while preserving native TypeScript checking paths |
| ` parser/vibelang_match_cache.go:Parser.cachePatternRead ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: retain per-evaluation property observations while preserving native TypeScript checking paths |
| ` parser/vibelang_match_cache.go:patternUsesPropertyCache ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: retain per-evaluation property observations while preserving native TypeScript checking paths |
| ` parser/vibelang_match_cache.go:patternUsesCache ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: retain per-evaluation property observations while preserving native TypeScript checking paths |
| ` parser/vibelang_match_cache.go:MatchIsTest ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: retain per-evaluation property observations while preserving native TypeScript checking paths |
| ` vibelang/match_lower.go:lowering.visitCachedPatternRead ` | ` admission:match ` | ` 004-match.md ` | ` support ` | VIP-7: retain per-evaluation property observations while preserving native TypeScript checking paths |
| ` parser/vibelang_match.go:Parser.parseMatchValueExpression@pattern-member-line-break ` | ` admission:pattern-member-line-break ` | ` - ` | ` pending ` | VIP-7 pinned computed member patterns have no line restriction; splitting an incomplete access into an `is` test and array statement reports only semantic errors |
| ` parser/vibelang_fibers.go:Parser.vibelangValueArrow ` | ` admission:is ` | ` 004-match.md ` | ` support ` | VIP-7: capture head cells with native value readers rather than introducing an Effect program; adds no source syntax |
| ` parser/vibelang_fibers.go:Parser.parenthesesLeadToArrow ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 recovery: reads an arrow operand after fork or a fork owner; introduces no syntax |
| ` parser/vibelang_fibers.go:Parser.skipParentheses ` | ` admission:fork ` | ` 900-appendices.md#ForkExpression ` | ` support ` | VIP-17 recovery: lookahead past balanced parentheses; introduces no syntax |
| ` parser/vibelang.go:Parser.isVibeLangFile@for-of-async-module ` | ` admission:for-of-async-module ` | ` - ` | ` pending ` | VIP-26 keeps native module syntax; the root `AwaitContext` hides `TS1106` for an ordinary `for (async of xs)` head |
| ` vibelang/error_constructor_lower.go:lowerFieldlessErrorConstructor ` | ` admission:error ` | ` 003-failures.md ` | ` recovery ` | VIP-13 rejects error inheritance; shared generated-constructor lowering preserves legacy payload handling for diagnostics and migration without admitting subclasses |
| ` parser/vibelang_effect.go:Parser.parseVibeLangEffectMember@optional-class-member ` | ` admission:effect-optional-class-member ` | ` 001-functions.md `, ` 002-running.md ` | ` admitted ` | VIP-1 and VIP-21 inherit native `async` class method positions; Appendix A omits the optional marker, tracked as a specification gap |
| ` vibelang/match_builtins.go:narrowConstructorExtraction ` | ` admission:match-builtins ` | ` 004-match.md ` | ` support ` | VIP-7 built-in extractor recognition follows native TypeScript tests |
| ` vibelang/producer_instance.go:lowering.nativeProducerCall ` | ` admission:producer ` | ` 900-appendices.md#Producer ` | ` support ` | VIP-21 emits the native project Stream callback and supplies its internal yield queue; no new syntax |
| ` parser/vibelang.go:Parser.vibelangSchemaProperties@schema-async-method ` | ` admission:schema-async-method ` | ` - ` | ` pending ` | VIP-15: a schema object-type alias reports only `EK2109` for an `async` method signature, covering native `TS1070` |
| ` parser/vibelang.go:Parser.vibelangSchemaProperties@schema-signature-parameter-modifier ` | ` admission:schema-signature-parameter-modifier ` | ` - ` | ` pending ` | VIP-15: a schema object-type alias reports only `EK2109` for a call signature, covering native parameter-modifier rejection |
| ` parser/vibelang.go:Parser.vibelangSchemaProperties@schema-static-method ` | ` admission:schema-static-method ` | ` - ` | ` pending ` | VIP-15: a `static` schema-alias method reports only `EK2109`, covering native `TS1070` |
| ` parser/vibelang.go:Parser.vibelangSchemaProperties@schema-effect-method ` | ` admission:schema-effect-method ` | ` - ` | ` pending ` | VIP-15: a schema object-type alias reports only `EK2109` for an `effect` method signature, covering the `EK0108` rejection of an `effect` type-literal member |
| ` parser/vibelang.go:Parser.vibelangSchemaProperties@schema-signature-reserved-binding ` | ` admission:schema-signature-reserved-binding ` | ` - ` | ` pending ` | VIP-15: a schema-alias signature reports only `EK2109` for a strict-mode reserved parameter binding, covering native `TS1212` |

</details>

<!-- grammar-admission:end -->

## Appendix B. Diagnostics

The old `EK1001` is retired and will never be reassigned: VIP-26 makes module-level calls ordinary JavaScript that may construct cold Effects; explicit `try` and `catch` outside Effect code retain `EK0501` and `EK0504` in every compiler host.

The old `EK4707` is retired and will never be reassigned: data-variant class patterns use `EK0702` under VIP-7.

The old `EK2118` is retired and will never be reassigned: VIP-13 rejects an error declaration's inheritance clause with `EK2117` before any generated subclass constructor is checked.

The old `EK4503` is retired and will never be reassigned: native TypeScript property diagnostics replace the denied service shorthand (VIP-10).

The old `EK4843` is retired and will never be reassigned: it was the entry-point warning. Under VIP-26 an exported lexical `main` keeps its ordinary binding, with no entry warning or declaration-changing quick fix.

The old `EK4408` is retired and will never be reassigned: VIP-40 owns `EK4001`–`EK4009`, and a duplicate module or a module/value collision is the error `EK4005`.

The old `EK4407` is retired and will never be reassigned: module-name resolution now follows VIP-40.

The old `EK4403` is retired and will never be reassigned: VIP-33 reports host clock and randomness reads as `EK4402` by resolved host origin.

The old `EK4405` is retired and will never be reassigned: hatches are retired, and VIP-6 permits lexical wrapper captures.

The old `EK9210` is retired and will never be reassigned: the first-release continuation retirement reports `EK3501` before provider or operation-contract analysis; VIP-35 remains open.

The old `EK0511` is retired and will never be reassigned: VIP-4 makes a `throw` in a plain `catch` handler the error `EK0401`.

Every diagnostic has an `EK` code and a message that says how to fix it (VIP-34). VibeLang's own rules take one hundred-block per VIP, `EK` then the two-digit VIP number then two digits, so VIP-19's rules are `EK19xx` (VIP-34, amended). Imported lint rules use the growing `EK38` decimal suffix below (VIP-34, amended). A code assigned before that scheme is kept where its rule is unchanged, or only widened or downgraded: `EK0801`, `EK1010`, `EK2109`, `EK2111`, `EK2117`, `EK2126`, `EK3001` to `EK3005`, `EK4402`, `EK4609`, `EK4610`, `EK4701` and `EK4802`. Codes are unique across the table, so a kept code may sit inside another VIP's block. Each rule's chapter links to its definition. A row whose rule starts "warning" or "lint warning" is a warning; a row starting "suggestion" is an editor suggestion; an interim row starting "off by default" is a disabled warning. Other VibeLang rows are errors; the imported table gives each lint rule’s explicit default. Only a warning's code, or an `EK38xx` code, may appear in `vibe.severities` (VIP-30, amended): `{ "EK0801": "off" }` is valid, `{ "EK4701": "off" }` is `EK3006`. Reused numbers: `EK2001` to `EK2005`, `EK2102` to `EK2104`, `EK3006`, `EK3007` and `EK3201` previously named different rules in the [old language’s diagnostic table](https://github.com/smithersai/vibelang/blob/main/docs/design/history/src/428-part4-ch28-tooling.md); in this table they mean only the rows below. The old `EK3008` is retired and will never be reassigned: its static service-key rule uses `EK0901`. VibeLang's own syntax errors have codes too, each in its VIP's block (`EK0509`, `EK1906`, `EK2005`, …). TypeScript's own diagnostics keep their `TS` codes. Diagnostic ownership follows the source rule, not the parser helper: new VibeLang productions, placement rules, adopted proposal early errors and explicit reconciliations use their owning VIP's `EK` code. Imported proposal syntax is not ordinary native TypeScript syntax. Independent errors in native embedded expressions and types keep their native diagnostics. Each Effect language-service rule that VIP-38 imports (`effecttsgo/*`) gets one stable `EK38xx` code, listed in a table generated from the pinned effect-tsgo version; the CLI prints the code and the rule name (`EK3801 floatingEffect: …`), a VIP-32 bump regenerates the table, and a code never changes once assigned. Every `EK38xx` code is a lint code that `vibe.severities` may set to any value, `"off"` included (VIP-38, amended). The [Imported lint codes](#imported-lint-codes) table below is generated from that pin.

The old `EK2101` is retired and will never be reassigned: it rejected a bodyless declaration whose return type was not an Effect, a restriction VIP-9 removed. The old `EK0511` is retired too: VIP-4 makes a `throw` in a plain `catch` handler the error `EK0401`. The old module-declaration codes are retired by [VIP-40](../vips/0040-module-declarations.md#diagnostics); its current rules use `EK4001`–`EK4009`.

The additional retained compiler and migration assignments are `EK1011`, `EK2112`, `EK2113`, `EK2120`, `EK2121`, `EK9001`, `EK9002`, `EK9003` and `EK9004`. Their definitions and existing VIP authorities are listed in the table below.

The TypeScript-form lint warnings also retain their existing `EK4830`–`EK4837`, `EK4839`, `EK4841` and `EK4842` assignments. Their triggers and safe repairs are in [TypeScript spellings with VibeLang forms](007-tooling.md#typescript-spellings-with-vibelang-forms). They are configurable warnings, separate from the imported Effect rules and their `EK38xx` codes. Transitional, migration and removal codes keep the assignments their sources give them, outside their VIPs' blocks, until a coordinated renumber: `EK1023` ([rejected trailing blocks](../vips/0011-trailing-blocks-denied.md#amendments)), `EK4607` ([retired `select`](000-intro.md#retired-continuation-forms)) and `EK4853` to `EK4857` (VIP-3 and VIP-9, amended). Obsolete owned-fiber, Option extension-method and magic-entry rules have no rows here.

| Code | Rule | VIP | Chapter |
| --- | --- | --- | --- |
| `EK0101` | `effect f() { }` or `async f() { }` outside a class or object literal Replay [example: main.vibe:3:8](../../../typescript/vibelang/cases/cov-ch900a-ek0101.fail/main.vibe). | 1 | [Functions](001-functions.md#effect-functions) |
| `EK0102` | `await`, `for await` or `await using` in effect code, or `await` in directly evaluated formal-parameter initialization of an Effect function, arrow, method or producer | 1, 5 | [Functions](001-functions.md#static-rules) |
| `EK0103` | `await` on an Effect in an `async` function or at the module top level | 1, 5 | [Functions](001-functions.md#static-rules) |
| `EK0104` | `effect` on a getter, setter or constructor | 1 | [Functions](001-functions.md#static-rules) |
| `EK0105` | `effect` and `async` on one function or block | 1 | [Functions](001-functions.md#static-rules) |
| `EK0106` | an `effect` function whose written return type is not an Effect | 1 | [Functions](001-functions.md#static-rules) |
| `EK0107` | `eval`, `Function`, `arguments`, `var` or `with` in a `.vibe` file; `globalThis` other than as the object of a statically named member; `.constructor` of a function; a `data:` or `blob:` import specifier; `var` in a pattern binding; a `do` early error uses `EK0201` or `EK0203` instead for the same declaration | 1, 4, 33 | [Functions](001-functions.md#direct-eval) |
| `EK0108` | a recognized `effect` modifier on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member | 1 | [Functions](001-functions.md#static-rules) |
| `EK0109` | a recognized `effect` arrow head that breaks its required form: a typed or generic bare parameter; parenthesize the parameters | 1 | [Functions](001-functions.md#static-rules) |
| `EK0201` | a `do` block whose last statement violates TC39's `EndsInIterationOrBareIfOrDeclaration` early error; replaces `EK0107` for the same `var`, and reports alongside `EK0203` when both apply | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0202` | a `break` or `continue` whose target is outside the block of an `effect { … }` expression Replay [example: main.vibe:4:72](../../../typescript/vibelang/cases/cov2-002a-block-outward-jump.fail/main.vibe). | 2 | [Running Effects](002-running.md#effect-blocks) |
| `EK0203` | `var` in a `do` expression in a parameter list; replaces `EK0107` for the same declaration, and reports alongside `EK0201` when both apply | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0205` | a `break` or `continue` in a loop head's `do` that leaves it unlabeled or targets that loop | 2 | [Running Effects](002-running.md#do-expressions) |
| `EK0301` | `!` beside a union, an intersection, a conditional type, or a function or constructor type in a slot, without parentheses: `A \| B!E`, `() => A!E \| B`, `A!() => B` (write `A!(() => B)`) Replay [example: main.vibe:3:10](../../../typescript/vibelang/cases/cov-ch900a-ek0301.fail/main.vibe). | 3 | [Functions](001-functions.md#the-aer-type-shorthand) |
| `EK0302` | `A!!B!C`: write `(A!!B)!C` or `A!(B!C)` | 3 | [Appendix A](#notes-on-the-productions) |
| `EK0401` | a `throw`, or a call known to throw outside the `try` block of a `try`/`catch` statement, in synchronous `.vibe` code outside effect code; any thrown type other than `never` in a plain function whose return type is wholly effectful, or in an effectful function's parameter list | 4, 5, 7 | [Failures](003-failures.md#plain-code-never-throws) |
| `EK0402` | a function that may throw where a function type doesn't admit its thrown type | 4, 39 | [Failures](003-failures.md#assignability) |
| `EK0403` | an unwrapped call, `new` expression, tagged template or class evaluation that may throw, in effect code; quick fixes, per the proxy ruling of 2026-11-04 on alchemy’s throwing helpers: first wrap with `try Effect.orDie(Effect.try({ try: () => call(), catch: (e) => e }))` to preserve defects and E, then offer adding `/** @throws {never} */` to a provably non-throwing same-project `.ts` declaration under [the quick-fix conditions](003-failures.md#plain-code-never-throws) | 4 | [Failures](003-failures.md#calls-in-effect-code) |
| `EK0404` | an unwrapped Promise-producing call (runtime `import()` included), `new` expression, tagged template or `async match` in effect code | 4, 5 | [Failures](003-failures.md#calls-in-effect-code) |
| `EK0406` | a `@throws` or `@rethrows` tag in `.vibe` or `.vibex` source outside a `module` body, including on a service member or function-type signature; quick fix: remove the tag | 4, 27 | [Failures](003-failures.md#thrown-types) |
| `EK0407` | the retired resolved `trusted(f, [])` wrapper; use the preserving `vibelang --fix` migration or a reviewed `.ts` helper with `@throws {never}` before rejection | 4 | [Migration](007-tooling.md#empty-legacy-trust-wrappers) |
| `EK0501` | `try` outside effect code, the top level included; the same rule applies to `try.all`, `try.race`, `try.any` or `try.allSettled` | 5, 18, 9 | [Running Effects](002-running.md#try) |
| `EK0502` | `try` on a value that is not an Effect | 5 | [Running Effects](002-running.md#try) |
| `EK0503` | a `try` statement in effect code; `vibelang --fix` applies the preserving `try statements` codemod | 5 | [Running Effects](002-running.md#try) |
| `EK0504` | `catch` outside effect code | 5 | [Running Effects](002-running.md#catch) |
| `EK0505` | `try x catch h`: a `try`, `try.all` (or another await operation), `fork` or `join` reachable from a `catch` head through unary and binary operator nodes only | 5, 17 | [Running Effects](002-running.md#catch) |
| `EK0506` | `e catch h` where `e` is not an Effect | 5, 17 | [Running Effects](002-running.md#catch) |
| `EK0507` | a plain handler whose result is a Promise or thenable | 5 | [Running Effects](002-running.md#catch) |
| `EK0508` | lint warning: a plain handler whose result is an Effect; use `catch effect` | 5, 38 | [Running Effects](002-running.md#catch) |
| `EK0509` | a `catch` handler that is not a plain or `effect` arrow or function expression: `a catch b`, `a catch effect { }`, `a catch async (e) => b`, `a catch function* (e) { }`; a parameter list followed directly by a block, as in `try x catch (e) { }`, gets `EK0509` without adding `EK0505` for the same malformed handler Replay [example: main.vibe:9:64](../../../typescript/vibelang/cases/catch-value-source-diagnostics.fail/main.vibe). | 5 | [Running Effects](002-running.md#catch) |
| `EK0510` | an unparenthesized `try`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` expression on the left of `**`, as ECMAScript rejects `await a ** b`; parenthesize it: `(try a) ** b` Replay [example: main.vibe:7:42](../../../typescript/vibelang/cases/execution-power.fail/main.vibe). | 5, 17, 18 | [Running Effects](002-running.md#static-rules) |
| `EK0512` | `catch` mixed with `??`, `\|\|` or `&&` without parentheses (parenthesize the mixed operands), or a member access or call after any closed handler (a parenthesized handler, a function-expression handler or a block-bodied arrow handler); parenthesize the whole catch expression | 5 | [Running Effects](002-running.md#catch) |
| `EK0701` | a missing `;` after a `match` arm, the last one included Replay [example: main.vibe:5:26](../../../typescript/vibelang/cases/data-declarations-match-separator.fail/main.vibe). | 7 | [Pattern matching](004-match.md#syntax-and-meaning) |
| `EK0702` | a class pattern that [Class patterns](004-match.md#class-patterns) rejects: it names a `data` declaration or variant, a `schema` or a directly built `Context.Reference`, or its callee has no usable signature or return type (a `service` is `EK3004`) | 7 | [Pattern matching](004-match.md#class-patterns) |
| `EK0703` | lint warning: an extractor whose argument count can never match its pattern's list, `when NotFound():` Replay [example: main.vibe:9:57](../../../typescript/vibelang/cases/match-extractor-arity/main.vibe). | 7, 38 | [Pattern matching](004-match.md#class-patterns) |
| `EK0704` | an extractor `when C(…)`, `C()` included, on an ordinary class without its own `Symbol.customMatcher` (an inherited one does not count); write `when C:` or `when C and { x: let x }:` (VIP-7, amended) Replay [example: main.vibe:4:60](../../../typescript/vibelang/cases/cov-ch900a-ek0704.fail/main.vibe). | 7 | [Pattern matching](004-match.md#class-patterns) |
| `EK0705` | an `is` lexical binding in an unbraced statement body (matching `TS1156`; the quick fix and `vibelang --fix` add braces), or one that would need formal-parameter or catch-parameter initialization as its home; use an explicit local block preserving the intended result and call phase; also a binding in an `enum` member initializer, which has no lexical home | 7 | [Pattern matching](004-match.md#is-bindings-in-parameter-initialization) |
| `EK0706` | a `return`, `break` or `continue` that leaves an `async match`; a nested function keeps its own `return` | 7 | [Pattern matching](004-match.md#async-match-jumps) |
| `EK0707` | invalid `match`/`is` grammar or a pattern-specific early error without a more specific assigned diagnostic; includes an interpolated primitive template pattern | 7 | [Pattern matching](004-match.md#syntax-and-meaning) |
| `EK0801` | warning: `using` in effect code; use `acquireDisposable` inside `scoped` | 34 | [Runtime](008-runtime.md) |
| `EK0901` | a `static key` without `readonly`, or whose initializer is not a string literal | 9 | [Services](005-services.md#static-rules) |
| `EK0902` | a service member that is not a `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` | 9 | [Services](005-services.md#static-rules) |
| `EK0903` | a service with no derived key and no `static readonly key` | 9 | [Services](005-services.md#static-rules) |
| `EK0904` | an `extends` or `implements` clause on a service: `service S extends Base { }` Replay [example: main.vibe:8:25](../../../typescript/vibelang/cases/ek0904-service-heritage.fail/main.vibe). | 9 | [Services](005-services.md#static-rules) |
| `EK0905` | `export default service S { }`; write `export { S as default }` Replay [example: commented.vibe:1:34](../../../typescript/vibelang/cases/service-default-export.fail/commented.vibe). | 9 | [Services](005-services.md#static-rules) |
| `EK0906` | a recognized service declaration missing its required body | 9 | [Services](005-services.md#static-rules) |
| `EK0907` | a custom `service` declaration in a native ambient source context, explicit or inherited; includes `declare service`, ahead of the same missing-body recovery | 9 | [Services](005-services.md#static-rules) |
| `EK0908` | two `service` members with no separator between them, such as `a: number b: string` on one line; write `;` or a line break between them (quick fix: insert `;`) Replay [example: main.vibe:4:74](../../../typescript/vibelang/cases/cov2-900b-cite-service-member-separator.fail/main.vibe). | 9 | [Services](005-services.md#static-rules) |
| `EK0909` | retired `service class Name { … }`; run `vibelang --fix` to remove `class` while preserving the service key and contract. Example: `service class Users { get(): string }` Replay [example: main.vibe:2:1](../../../typescript/vibelang/cases/retired-service-class.fail/main.vibe). | 9 | [Services](005-services.md#syntax) |
| `EK1010` | a forbidden punctuator follows a throw expression; parenthesize the operand or the whole throw; `--fix` groups the whole throw before a legacy comma separator | 41 | [Failures](003-failures.md#throw-expressions) |
| `EK1101` | a trailing block: a `{` on the same line after a name, a property access or a call, `f(x) { … }` or `f { … }`, outside a heritage clause and a `provide` block's providers, where no TypeScript or VibeLang production admits the `{` (so `effect { … }`, `match (x) { … }`, `namespace A.B { … }` and declaration heads such as `service S { … }` are not trailing blocks); quick fix: pass the block as the call's last argument, `f(x, effect { … })` where it ran as a program, `f(x, effect () => { … })` where it ran as an Effect function, `f(x, () => { … })` otherwise Replay [example: main.vibe:9:45](../../../typescript/vibelang/cases/trailing-block-denied.fail/main.vibe). | 11 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK1201` | `provide` outside effect code | 12 | [Services](005-services.md#provide-blocks) |
| `EK1202` | a line break immediately before or after a top-level provider-separating `,` | 12 | [Services](005-services.md#provide-blocks) |
| `EK1301` | a constructor in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1302` | a user-written `static` member or setter in an `error` or `schema error` body | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1303` | type parameters on an `error` or `schema error` declaration | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1304` | any other `RejectedElement` in an `error` or `schema error` body; an `implements` clause | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1305` | `export default error E` or `export default schema error E`; write `export { E as default }` Replay [example: bodyless.vibe:1:16](../../../typescript/vibelang/cases/error-default-export.fail/bodyless.vibe). | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1306` | two `error` or `schema error` body members with no separator between them; write `;` or a line break between them (quick fix: insert `;`) Replay [example: main.vibe:4:21](../../../typescript/vibelang/cases/missing-body-separator.fail/main.vibe). | 13 | [Appendix A](#separator) |
| `EK1307` | a recognized custom `error` or `schema error` declaration in an ambient source context, whether its own `declare` or an enclosing ambient namespace, module, global region or declaration file; write a native ambient class, or move the declaration to runtime code | 13 | [Failures](003-failures.md#error-declarations) |
| `EK1401` | a namespace name that two subpaths export, or a subpath and the root | 14 | [Services](005-services.md#the-platform-standard-library) |
| `EK1402` | retirement-target error, after the migration gate in chapter 007: retired Effect data receiver-method extension, such as `Option.some(1).map(f)`; use `Option.map(Option.some(1), f)` or the preserving `vibelang --fix` migration; refuse unsafe bindings or changed declarations | 14 | [Migration](007-tooling.md#legacy-data-receiver-methods) |
| `EK1501` | `export default schema S …`; write `export { S as default }` Replay [example: main.vibe:2:16](../../../typescript/vibelang/cases/cov-ch900a-ek1501.fail/main.vibe). | 15 | [Data](006-data.md#schema-declarations) |
| `EK1502` | type parameters on a `schema` declaration; use an ordinary generic TypeScript factory | 15 | [Data](006-data.md#schema-declarations) |
| `EK1503` | a recognized ordinary schema declaration missing its required body or admitted alias form | 15 | [Data](006-data.md#schema-declarations) |
| `EK1504` | two `schema` fields with no separator between them; write `;` or a line break between them (quick fix: insert `;`) | 15 | [Data](006-data.md#schema-declarations) |
| `EK1505` | a member of a `schema` body that is not a `Field` | 15 | [Data](006-data.md#schema-declarations) |
| `EK1506` | a `schema` declaration in an ambient source context, explicit or inherited | 15 | [Data](006-data.md#schema-declarations) |
| `EK1601` | a `data` variant field named `_tag` | 16 | [Data](006-data.md#data-declarations) |
| `EK1603` | `export default data D { … }`; write `export { D as default }` Replay [example: main.vibe:2:16](../../../typescript/vibelang/cases/cov-ch900a-ek1603.fail/main.vibe). | 16 | [Data](006-data.md#data-declarations) |
| `EK1602` | a `data` variant named `$is` or `$match`; rename it and its resolved references | 16, 28 | [Data](006-data.md#data-declarations) |
| `EK1604` | a recognized data declaration missing its required variant body | 16 | [Data](006-data.md#data-declarations) |
| `EK1605` | two variants of a `data` declaration, or two fields of a variant, with no separator between them; write `;` or a line break between them (quick fix: insert `;`) Replay [example: main.vibe:2:18](../../../typescript/vibelang/cases/data-member-separators.fail/main.vibe). | 16 | [Data](006-data.md#data-declarations) |
| `EK1606` | a malformed `data` variant or a payload member that is not a `Field` | 16 | [Data](006-data.md#data-declarations) |
| `EK1607` | a `data` declaration in an ambient source context, explicit or inherited | 16 | [Data](006-data.md#data-declarations) |
| `EK1701` | `fork` or `join` outside effect code | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1702` | `fork` or `join` as an `effect` function or producer expression's own name, or as a variable, parameter or label name in effect code, in the parameters of an `effect` function, arrow, method or producer, or in a plain or `async` arrow head inheriting that reservation, including one in an Effect callable's parameters; the arrow body has its own context; or a reserved `fork` or `join` as a shorthand property, `{ join }` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1703` | a `fork`, `fork.in(s)`, `fork.scoped` or `fork.detached` operand that fails the operand test of `try` Replay [example: main.vibe:2:45](../../../typescript/vibelang/cases/cov-ch900a-ek1703.fail/main.vibe). | 5, 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1704` | a `join` operand not assignable to `Fiber.Fiber<any, any>` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1705` | a `fork.` owner other than `in(s)`, `scoped` or `detached`: `fork.other e` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1706` | a `fork.in(s)` scope operand not assignable to `Scope.Scope` | 17 | [Running Effects](002-running.md#fork-and-join) |
| `EK1707` | a bare `fork { … }` block; write `fork effect { … }` or use the `fork blocks` codemod before rejection | 2, 17 | [Migration](007-tooling.md#legacy-fork-try-statement-and-wire-migration) |
| `EK1801` | an operand that is not an array of Effects, using assignability to `ReadonlyArray<Effect.Effect<any, any, any>>`, for `try.all`, `try.race`, `try.any` or `try.allSettled` | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1802` | a retired `await.all`, `await.race`, `await.any` or `await.allSettled`; quick fix: the `try` operation that replaces it | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1803` | a name after `try.` other than `all`, `race`, `any` or `allSettled`: `try.map x` | 18 | [Running Effects](002-running.md#running-effects-concurrently) |
| `EK1901` | a `for concurrent` operand not assignable to `Iterable<unknown>` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1902` | `for concurrent` outside effect code | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1903` | `break` leaving head binding initialization or the body of `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1904` | `return` in head binding initialization or the body of `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1905` | a labeled `continue` naming a statement that encloses the `for concurrent` | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1906` | a `var`, `using`, `await using` or assignment head in `for concurrent`: any head other than a `const` or `let` declaration | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK1907` | a `for concurrent` limit not assignable to `Types.Concurrency` (`number \| "unbounded"`) | 19 | [Running Effects](002-running.md#for-concurrent) |
| `EK2001` | `for try` outside effect code | 20 | [Running Effects](002-running.md#for-try) |
| `EK2002` | `return` in head binding initialization or the body of `for try` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2003` | a labeled `break` or `continue` from `for try` head binding initialization or the body to a statement that encloses the `for try`; one naming the `for try` itself is its unlabeled `break` or `continue` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2004` | a `for try` operand not assignable to `Stream.Stream<any, any, any>` | 20 | [Running Effects](002-running.md#for-try) |
| `EK2005` | a `var`, `using`, `await using` or assignment head in `for try`: any head other than a `const` or `let` declaration | 20 | [Running Effects](002-running.md#for-try) |
| `EK2102` | a producer whose written return type is incompatible with its Stream result, under TypeScript's ordinary return checking | 21 | [Running Effects](002-running.md#producers) |
| `EK2103` | `yield*` in a producer | 21 | [Running Effects](002-running.md#producers) |
| `EK2104` | `yield` in nonproducer effect code (an `effect` function, arrow or block), whether or not an outer producer exists, or in directly evaluated formal-parameter initialization of an Effect callable or producer | 21 | [Running Effects](002-running.md#producers) |
| `EK2109` | a `schema` field type outside the mapping (including a shadowing type without a suitable Schema value), or conflicting/unprovable referenced-schema decoded-key flags at a required or effectively readonly position | 15 | [Data](006-data.md#schema-declarations) |
| `EK2111` | `restore` outside an `uninterruptible` block | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2117` | an `extends` clause or a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `"_tag"` | 13 | [Failures](003-failures.md#error-declarations) |
| `EK2126` | a constraint on a generic `data` type parameter | 28 | [Data](006-data.md#generic-unions) |
| `EK2128` | `return value` in a producer: a Stream has no return value; write a bare `return` to end the stream | 21 | [Running Effects](002-running.md#producers) |
| `EK2201` | an interruption block outside effect code | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2202` | `restore` that captures an outer mask across an independent `effect` function, arrow, method, producer or block, or `restore` in any `for concurrent` head binding initialization or body | 22 | [Running Effects](002-running.md#interruption-blocks) |
| `EK2301` | adopted pipe grammar and early errors without a more specific code, including a missing topic and a whole bare plain, `async` or `effect` arrow as a pipe body; parenthesize the arrow, `x \|> (() => %)`. For an unparenthesized conditional at either end of a pipe, `x \|> f(%) ? a : b`: the pinned proposal's conditional-body error and a pipe as a conditional's test; write `(x \|> f(%)) ? a : b` to test the result or `x \|> (f(%) ? a : b)` to pipe into the conditional Replay [example: main.vibe:8:27](../../../typescript/vibelang/cases/cov-ch002b-running-pipe-missing-topic-absent.fail/main.vibe). | 23 | [Running Effects](002-running.md#the-pipe-operator) |
| `EK2401` | the retired resolved `wire` intrinsic; compose Layers explicitly or use the preserving `wire compositions` codemod before rejection | 24 | [Migration](007-tooling.md#legacy-fork-try-statement-and-wire-migration) |
| `EK2601` | a retired `vibelang/platform/node`, `vibelang/platform/bun` or `vibelang/platform/browser` entry marker; run `vibelang --fix` to preserve startup with an explicit runner, or migrate manually when preservation cannot be proved | 26 | [Migration](007-tooling.md#legacy-entry-dispatch-migration) |
| `EK2801` | a `data` declaration with more than 4 type parameters | 28 | [Data](006-data.md#generic-unions) |
| `EK2803` | a default on a generic `data` type parameter | 28 | [Data](006-data.md#generic-unions) |
| `EK3001` | two services with the same key | 9 | [Services](005-services.md#static-rules) |
| `EK3002` | a class extends a service | 9 | [Services](005-services.md#static-rules) |
| `EK3003` | `new` on a service | 9 | [Services](005-services.md#static-rules) |
| `EK3004` | `instanceof` a service, or a class pattern naming any `service` declaration, with or without `defaultValue` | 7, 9 | [Services](005-services.md#static-rules) |
| `EK3005` | a generic service, or a service whose resolved member contracts capture an outer type parameter | 9 | [Services](005-services.md#static-rules) |
| `EK3006` | an error code, an interim `EK92xx` code (even one printed as a warning) or an unknown code in `vibe.severities`, or a severity entry whose value is not one of the four strings, whatever its JSON type | 30 | [Configuration and tooling](007-tooling.md) |
| `EK3007` | an unknown `vibe` key, or a `vibe` value of the wrong type other than a `severities` entry (`EK3006`), including a `severities` value that is not an object | 30 | [Configuration and tooling](007-tooling.md#config-files) |
| `EK3009` | warning: root `vibelang.diagnostics` or `compilerOptions.vibelang.diagnostics` in any supported config or extended config needs migration; supported legacy settings still apply, modern entries win, and `--fix` migrates eligible maps | 30 | [Legacy severity maps](007-tooling.md#legacy-severity-maps) |
| `EK3010` | warning: retired `trustedPackages` is ignored in `vibe` and supported legacy sections; remove the key and use the ordinary foreign-callable contract | 4, 30 | [Configuration](007-tooling.md#config-files) |
| `EK3011` | warning: retired root `vibelang.declarationImportStyle` or `compilerOptions.vibelang.declarationImportStyle` is ignored for every value, including invalid values; remove the setting | 30 | [Configuration](007-tooling.md#config-files) |
| `EK3012` | warning: an assigned `EK38xx` severity key without a resolved `@effect/language-service` plugin entry needs the preserving config migration; `vibelang --fix` writes the explicit plugin entry while retaining inherited plugins and authored settings | 30, 38 | [Imported lint activation migration](007-tooling.md#effects-type-aware-lint) |
| `EK3201` | a resolved `effect` version other than the pin | 32 | [Configuration and tooling](007-tooling.md#the-effect-version) |
| `EK4001` | a module declaration below the file's top level | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4002` | an exported module declaration | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4003` | a module expression | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4004` | a module's name used as a value | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4005` | a module's name redeclares a binding of the file | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4006` | an identifier specifier naming no module declaration of the file, or carrying import attributes | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4007` | an identifier specifier inside a module body | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4008` | `export =` or `import x = require()` in a module body Replay [example: main.vibe:4:3](../../../typescript/vibelang/cases/cov2-900b-cite-ek4008-module-cjs.fail/main.vibe). | 40 | [Modules](001-functions.md#module-declarations) |
| `EK4009` | `import.meta` in a module body | 40 | [Modules](001-functions.md#module-declarations) |
| `EK3410` | retired `mutable` marker on an ordinary type member or plain-error payload; run `vibelang --fix` to remove redundant markers or preserve payloads in a compatibility class; enforce after preserving migration | 34 | [Migration](007-tooling.md#ordinary-mutable-marker-migration) |
| `EK3501` | retired continuation forms: `control`/`handle` syntax or resolved continuation-runtime `Control`, `resume`, `resumeWith`, `abandon` or `handle`; migrate proved local service patterns with `vibelang --fix`, otherwise repair manually | 35 (open; removal only) | [Retirement](000-intro.md#retired-continuation-forms) |
| `EK4402` | interim warning inside formerly accepted boundary callbacks; error otherwise: a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), a string-literal `import(…)` of one, or a statically named value that [reaches the platform](005-services.md#reaches-the-platform): a global declared by `lib.dom`, `lib.webworker`, `lib.scripthost` or `@types/node` and not by `lib.es*` or `lib.decorators*`, minus the allowlist, or a banned member of an allowlisted global, in a `.vibe` file Replay [example: main.vibe:4:74](../../../typescript/vibelang/cases/cov-ch002b-running-import-forbidden-builtin.fail/main.vibe). Category variants: `error`, `warning`. A legacy hatch callback warns while the preserving platform migration remains incomplete; other platform uses keep their errors. | 33 | [Services](005-services.md#the-platform-standard-library) |
| `EK4607` | retired `select` block; `vibelang --fix` refuses an unproved selection rewrite | 18 (removal only) | [Retirement](000-intro.md#retired-continuation-forms) |
| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; to obtain its result in that context, use `await runPromise(Fiber.join(fiber))` Replay [example: main.vibe:2:70](../../../typescript/vibelang/cases/await-handle-async-warnings/main.vibe). | 5 | [Running Effects](002-running.md#await) |
| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; to obtain its result in that context, use `await runPromise(Deferred.await(deferred))` Replay [example: main.vibe:3:79](../../../typescript/vibelang/cases/await-handle-async-warnings/main.vibe). | 5 | [Running Effects](002-running.md#await) |
| `EK4701` | a `match` with no `default` whose subject passes the exhaustiveness check and misses a case; a guarded arm covers nothing | 7 | [Pattern matching](004-match.md#exhaustiveness) |
| `EK4802` | warning (advisory; may be ignored or configured to `"off"`): a plain call in effect code that is not the direct operand of `try` infers an Effect for its own type parameter at an argument outside a declared Effect position; [VIP-1’s dated amendment](../vips/0001-effect-and-async-functions.md#amendment-inferred-effect-arguments-2026-11-03) defines the inferred-argument positions, opt-outs and repairs. A project where `--fix-vip-only` refused a call sets this warning to `"error"` project-wide | 1, 5 | [Configuration and tooling](007-tooling.md#effects-type-aware-lint) |
| `EK4830` | lint warning: A class written with `Data.TaggedError("Name")` Replay [example: main.vibe:9:7](../../../typescript/vibelang/cases/ek2004-dead-catch.fail/main.vibe). | 13, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4831` | lint warning: A class written with `Context.Service` | 9, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4832` | lint warning: A `const` holding `Schema.Struct({ … })` | 15, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4833` | lint warning: A written `Effect.Effect<A, E, R>` type | 3, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4834` | lint warning: `Effect.succeed(v)` or `Effect.fail(e)` as the direct operand of bare `try` in effect code Replay [example: main.vibe:13:5](../../../typescript/vibelang/cases/ek2004-dead-catch.fail/main.vibe). | 4, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4835` | lint warning: `Effect.catch`, `Effect.catchTag`, or `Effect.catchTags` as the direct operand of bare `try` in effect code | 5, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4836` | lint warning: `Effect.provide` or `Effect.provideService` as the direct operand of bare `try` in effect code | 12, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4837` | lint warning: A class written with `Schema.TaggedError`, except one with spread fields or a user-written static `_tag` | 29, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4839` | lint warning: An Effect `Match` chain with a supported finisher, or a direct `Option.match(value, handlers)` call Replay [example: main.vibe:8:10](../../../typescript/vibelang/cases/tsforms-match/main.vibe). | 7, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4841` | lint warning: A schema `const` immediately followed by its matching `typeof Name.Type` alias | 15, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK4842` | lint warning: An Effect module imported under a conflicting JavaScript global name | 14, 34 | [Configuration and tooling](007-tooling.md#typescript-spellings-with-vibelang-forms) |
| `EK1011` | compiler dependency error: an Effect construct cannot resolve the installed Effect type; install the pinned peer before compiling. Example: `effect function f() { return 1 }` with no resolvable Effect package | 6, 32, 34 | [Tooling](007-tooling.md#the-effect-version) |
| `EK2112` | warning: a legacy catch clause tests its failure's type; the preserving migration removes the annotation and tests the value with `match` or `is`. Example: `catch (e: NotFound) { recover(e) }` in legacy effect code Replay [example: main.vibe:7:15; also EK2105](../../../typescript/vibelang/cases/decl-catch-untagged.fail/main.vibe). | 5, 34 | [Running Effects](002-running.md#catch) |
| `EK2113` | warning: a legacy Cause-typed catch clause; migrate to matching `exit(program)` with `Exit.Success` and `Exit.Failure`. Example: `catch (cause: Cause.Cause<E>) { recover(cause) }` in legacy effect code Replay [example: main.vibe:13:19](../../../typescript/vibelang/cases/primitives.fail/main.vibe). | 5, 34 | [Running Effects](002-running.md#catch) |
| `EK2120` | warning: the legacy `control class` declaration spelling in editor semantic diagnostics; its editor repair removes `class`. Example: `control class Approval { }` [editor example: control-class-warning]. Ordinary compilation rejects the header with `EK3501` before semantic checking. | 9, 35, 34 | [Tooling](007-tooling.md#vibelang-warnings) |
| `EK2121` | error: a retired layer declaration; migrate to an equivalent `Layer.effect` or `Layer.succeed` call, retaining construction timing and requirements. Example: `layer UsersLive: Users { get() { return "Ada" } }` Replay [example: main.vibe:8:8](../../../typescript/vibelang/cases/decl-layer-order.fail/main.vibe). | 12, 34 | [Tooling](007-tooling.md#retired-layer-declarations) |
| `EK9001` | compiler projection error: a source form cannot be represented safely by the stock-TypeScript mapper; use the diagnosed explicit annotation or helper, or the native compiler. Example: mapper: `Effect.all(...groups)` with an overload the mapper cannot select | 34 | [Tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK9002` | compiler projection error: the mapper's executable rendering does not parse as TypeScript; report the source and use the native compiler. Example: mapper: a rendered executable with an unclosed expression | 34 | [Tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK9003` | mapper configuration error: its options must be an empty object; remove unsupported mapper options. Example: mapper options: `{ "unsupported": true }` | 30, 34 | [Tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK9004` | mapper dependency version error: the resolved Effect or platform package differs from the version pinned by the mapper's forms table; align the package and table versions. Example: mapper project resolves `effect@4.0.3` while its forms table pins `effect@4.1.1` | 32, 34 | [Tooling](007-tooling.md#the-effect-version) |

Trailing blocks are rejected by [VIP-11](../vips/0011-trailing-blocks-denied.md#amendments); their preserving repair and native-parser recovery follow VIP-34. Classification requires proven legacy lowering, never the callee's parameter type alone. Versioned dual compatibility retains its native call error (`TS2345` for an incompatible argument, `TS2554` for a wrong argument count or `TS2769` when no overload matches), or transitional `EK1023` when appending the block type-checks with changed meaning, without duplicate `EK1101`.

### Transitional compiler diagnostics

The legacy bare prelude `Scope` type and same-named module-export shorthand have no diagnostic while the transitional compiler accepts them. Their [migration](007-tooling.md#legacy-prelude-shorthand) writes `Scope.Scope`, `Option.Option<A>` and `FileSystem.FileSystem.of(impl)`. Coordinated removal follows preserving codemods and zero remaining migration-repository uses; afterwards the equivalent namespace imports report native `TS2709` for namespace-as-type uses and `TS2339` for absent namespace members. This compatibility allocates no `EK` code.

A transitional compiler may still print compatibility diagnostics from the old language. The following inventory covers the `EK92xx` codes in its [registry](../../../typescript/tsc/internal/vibelang/diagnostics.go), separately from the normative rules above: an interim code does not establish a language rule or reserve a new VIP block. Their retirement follows the named VIPs; a compiler renumbering must update this inventory with the registry.

| Emitted code | Rule | Retirement VIP | Replacement |
| --- | --- | --- | --- |
| interim `EK1308` | warning: an abstract error root is a legacy declaration form. Example: `abstract error Root`; use the preserving fix to retain its Effect TypeScript class. [Executable migration example](../../../typescript/vibelang/cases/decl-error-abstract-fix/run.mjs). | 13, 29 | Run `vibelang --fix`. |
| interim `EK9201` | error: an expected failure escapes the written error contract | 1, 3 | Ordinary checked Effect return types and assignability |
| interim `EK9202` | error: a requirement escapes the written requirement contract | 1, 3 | Ordinary checked Effect return types and assignability |
| interim `EK9203` | error: a plain return annotation is on a function or native generator whose body runs an Effect or can fail; [mapper example: plain-contract](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go) | 1, 4 | Keywords decide function kind; ordinary JavaScript throws follow the accepted thrown-type rules |
| interim `EK9204` | warning: an old Effect `try`/`catch` statement has no expected errors, or the head of a `catch` expression cannot fail, reported at its `catch` keyword Replay [example: main.vibe:25:28](../../../typescript/vibelang/cases/catch-expression.fail/main.vibe). | 5 | Statement: Effect code has no `try` statement (`EK0503`); an infallible Effect is still run with `try e`. Expression: `succeed(2) catch (e) => 0` is valid; the warning retires with no successor |
| interim `EK9205` | error: a declaration without a body has a return type that is not an Effect | 1, 9 | Ordinary TypeScript declarations and service members may have non-Effect return types; an omitted service method or property type follows native `noImplicitAny` (`TS7010`/`TS7008`), not this interim rule |
| interim `EK9206` | error: a recursive function has a success type that depends on its own result, or the legacy partial-contract inference cannot break its call cycle | 1, 3 | Ordinary TypeScript inference and its own recursion diagnostics; no VibeLang recursion diagnostic |
| interim `EK9207` | error: a service or control contract member has a body or initializer, or an instance member is placed in a legacy shape-only service body | 9 | Accepted service-member restrictions use `EK0902`; control syntax remains historical, not an accepted construct |
| interim `EK9208` | error: a static service member has the same name as an instance service member | 9 | Accepted service shapes and their restricted static members follow the ordinary `Context.Service` counterpart |
| interim `EK1003` | error: legacy compiler compatibility — `await using` is rejected by the legacy non-async fallback. Ordinary async code permits Promise-based iteration/disposal; effect code uses `EK0102`. Replay [example: main.vibe:1:1](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1003). | 1, 5 | [Rule chapter](002-running.md) |
| interim `EK1015` | error: legacy compiler compatibility — the legacy checker rejects `yield*` in code it classified as an implicit program. Use `try` in effect code; ordinary JavaScript generators retain `yield*`. Replay [example: main.vibe:1:17](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1015). | 1, 21 | [Rule chapter](002-running.md) |
| interim `EK1017` | error: legacy compiler compatibility — `provide` is used as an expression. Use a `provide` statement and return from its block. Replay [example: main.vibe:1:37](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1017). | 12 | [Rule chapter](005-services.md) |
| interim `EK2114` | error: legacy compiler compatibility — a catch expression appears inside a legacy hatch body. Hatches are retired; native `.ts` code uses JavaScript try statements. Replay [example: main.vibe:1:42](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK2114). | 5, 6 | [Rule chapter](003-failures.md) |
| interim `EK2127` | error: legacy compiler compatibility — a data type's value is accessed through a nonexistent variant name. Use a declared variant; keep native errors for independent TypeScript member failures. Replay [example: main.vibe:3:23](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK2127). | 16 | [Rule chapter](006-data.md) |
| interim `EK3206` | error: legacy compiler compatibility — legacy platform imports name two different platforms in one file. Use the selected platform services explicitly; namespace imports alone do not start a host. Replay [example: main.vibe:2:8](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK3206). | 14, 33 | [Rule chapter](005-services.md) |
| interim `EK4201` | error: legacy compiler compatibility — a legacy control operation runs under a combinator on another fiber. Handlers remain an open proposal.  Emission witness pending for `EK4201`: its archived control input is rejected earlier by `EK3501`. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 35 | [Rule chapter](003-failures.md) |
| interim `EK4401` | error: legacy compiler compatibility — a listed-failure wrapper names a class that no imported module exports. Export the listed class from an imported module, or use an explicit `Effect.try` boundary. Replay [example: main.vibe:3:10](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4401-unexported-class). | 4 | [Rule chapter](003-failures.md) |
| interim `EK4410` | error: legacy compiler compatibility — a legacy syntax intrinsic such as a hatch or prelude `fork`/`join` is stored or renamed. Hatches are retired; native `fork` and `join` use the accepted syntax and reservation rules. Replay [example: main.vibe:1:26](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4410). | 6, 17 | [Rule chapter](002-running.md) |
| interim `EK4501` | error: legacy compiler compatibility — a legacy data-type extension method is accessed without a direct call. No accepted VIP introduces these extension methods; call the native module function. Replay [example: main.vibe:2:26](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4501). | 6 | [Rule chapter](007-tooling.md) |
| interim `EK4502` | error: legacy compiler compatibility — a legacy automatically run call's success value is used as though it had a `pipe` method. Effect calls return cold Effects; native member access keeps ordinary TypeScript meaning. Replay [example: main.vibe:1:64](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4502). | 1, 23 | [Rule chapter](002-running.md) |
| interim `EK4602` | error: legacy compiler compatibility — the legacy checker rejects awaiting a Promise. Promises may be awaited in async code; use `tryPromise` and `try` in effect code. Replay [example: main.vibe:2:53](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4602). | 1, 5 | [Rule chapter](002-running.md) |
| interim `EK4603` | error: legacy compiler compatibility — the legacy checker rejects awaiting a non-`Fiber` value. Async code retains ordinary JavaScript await semantics. Replay [example: main.vibe:1:57](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4603). | 1, 5 | [Rule chapter](002-running.md) |
| interim `EK4703` | error: legacy compiler compatibility — the legacy lowering cannot supply an `is` binding's lexical home. Accepted binding homes follow the chapter; formal/catch parameter restrictions use `EK0705`. Replay [example: main.vibe:2:22](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4703). | 7 | [Rule chapter](004-match.md) |
| interim `EK4805` | warning: legacy compiler compatibility — a class extends a native global `Error`. Use `error` for a tagged failure; the imported native-error rule has its `EK38…` identity. Replay [example: main.vibe:1:14](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4805). | 13, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4806` | warning: legacy compiler compatibility — a failure-mapping callback returns `unknown` or `any`. Use a typed tagged error; imported catch lint has its `EK38…` identity. Replay [example: main.vibe:1:77](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4806). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4812` | warning: legacy compiler compatibility — `new Promise` appears in code the legacy checker treats as effect code. Ordinary JavaScript may construct Promises; run a Promise in effect code through `tryPromise`. Replay [example: main.vibe:1:23](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4812). | 1, 5, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4813` | error: legacy compiler compatibility — a resolved Effect API uses a renamed or removed Effect 3 spelling. Use the pinned Effect 4 API; the imported outdated-API rule has its assigned identity. Replay [example: main.vibe:1:31](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4813). | 32, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4816` | off by default (warning when enabled): legacy compiler compatibility — a layer is provided at a site checked by the legacy strict-provision rule. Legacy optional port of imported strict-provision lint; default off. Replay [example: main.vibe:1:38; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4816). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4818` | off by default (warning when enabled): legacy compiler compatibility — `JSON.parse` or `JSON.stringify` is used without a schema. The optional legacy preference defaults off; imported lint has its assigned identity. Replay [example: main.vibe:1:10; warning; also EK0401](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4818). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4821` | off by default (warning when enabled): legacy compiler compatibility — a `Schema.Struct` has a literal `_tag` field. Optional legacy repair to `Schema.TaggedStruct`; default off. Replay [example: main.vibe:1:23; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4821). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4822` | off by default (warning when enabled): legacy compiler compatibility — a condition is not a boolean. Optional legacy strict-boolean lint; default off. Replay [example: main.vibe:1:7; error; also TS2304](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4822). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4823` | off by default (warning when enabled): legacy compiler compatibility — an arrow block contains only a returned expression. Optional legacy expression-body repair; default off. Replay [example: main.vibe:1:48; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4823). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4824` | off by default (warning when enabled): legacy compiler compatibility — a pipe has no functions. Optional legacy unnecessary-pipe repair; default off. Replay [example: main.vibe:1:21; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4824). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4825` | off by default (warning when enabled): legacy compiler compatibility — a pipe continues another pipe. Optional legacy pipe-chain repair; default off. Replay [example: main.vibe:1:22; error; also EK4840](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4825). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK1002` | error: legacy compiler compatibility — a generator-based API receives a legacy producer. Native `function*` retains JavaScript generator semantics; an Effect producer is explicitly `effect function*`. Replay [example: main.vibe:7:12](../../../typescript/vibelang/cases/effect-gen-computed-method.fail/main.vibe). | 21 | [Rule chapter](002-running.md) |
| interim `EK1005` | error: legacy compiler compatibility — a root runner is called inside code already running on a fiber. Run the Effect with `try` in effect code; explicit runner APIs keep their Effect behavior. Replay [example: main.vibe:44:3](../../../typescript/vibelang/cases/ek1005-runners.fail/main.vibe). | 1, 34 | [Rule chapter](002-running.md) |
| interim `EK1012` | warning: legacy compiler compatibility — a legacy automatically run call that never succeeds is stored. Calls return values normally; an Effect is run explicitly with `try`. Replay [example: main.vibe:19:19; error; also EK4834](../../../typescript/vibelang/cases/never-stored.fail/main.vibe). | 1, 3 | [Rule chapter](001-functions.md) |
| interim `EK1013` | error: legacy compiler compatibility — a comma remains a class-body separator in an inherited error or control declaration; root error payload fields, data variants, services and schema fields accept the shared separators.  Emission witness pending for `EK1013`: the archived input does not reach this reporter on the current compiler. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 9, 13, 15, 16, 29 | [Rule chapter](900-appendices.md#separator) |
| interim `EK2006` | error: legacy compiler compatibility — a legacy effect `finally` block contains an outward `return`, `break` or `continue`. Effect code rejects `try` statements with `EK0503`; native `finally` keeps JavaScript completion semantics. Replay EK2006 [example: main.vibe:12:5](../../../typescript/vibelang/cases/ek2006-finally-jump.fail/main.vibe). | 5 | [Rule chapter](003-failures.md) |
| interim `EK2105` | error: legacy compiler compatibility — a typed legacy `catch` clause names a union member without a literal `_tag`. Use a function-literal catch handler and match its error; Effect catch clauses are retired. Replay [example: main.vibe:7:15; also EK2112](../../../typescript/vibelang/cases/decl-catch-untagged.fail/main.vibe). | 5 | [Rule chapter](003-failures.md) |
| interim `EK2106` | error: legacy compiler compatibility — a legacy `catch` clause follows one that catches every failure. Use the accepted catch expression or a native JavaScript catch clause. Replay [example: main.vibe:11:15; also EK2112](../../../typescript/vibelang/cases/decl-catch-order.fail/main.vibe). | 5 | [Rule chapter](003-failures.md) |
| interim `EK2107` | error: legacy compiler compatibility — a legacy `handle` clause names a value that is not a control declaration. Handlers remain an open proposal; this is not an accepted handler rule.  Emission witness pending for `EK2107`: its archived control input is rejected earlier by `EK3501`. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 35 | [Rule chapter](003-failures.md) |
| interim `EK2108` | error: legacy compiler compatibility — a legacy `handle` statement omits a control operation clause. Handlers remain an open proposal.  Emission witness pending for `EK2108`: its archived control input is rejected earlier by `EK3501`. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 35 | [Rule chapter](003-failures.md) |
| interim `EK2110` | error: legacy compiler compatibility — a non-tail legacy `resume` reads a result whose type omits a possible handler result. Handlers remain an open proposal.  Emission witness pending for `EK2110`: its archived control input is rejected earlier by `EK3501`. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 35 | [Rule chapter](003-failures.md) |
| interim `EK2119` | error: legacy compiler compatibility — a legacy handler clause returns a value outside a waiting `resume`'s answer type. Handlers remain an open proposal.  Emission witness pending for `EK2119`: its archived control input is rejected earlier by `EK3501`. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 35 | [Rule chapter](003-failures.md) |
| interim `EK3101` | error: legacy compiler compatibility — a legacy provider reads a service at call time where its contract admits no requirements. Check explicit service shapes and Effect requirement types; no implicit provider method is introduced. Replay [example: main.vibe:15:12](../../../typescript/vibelang/cases/d362-service-default-contract.fail/main.vibe). | 9, 12 | [Rule chapter](005-services.md) |
| interim `EK3202` | error: legacy compiler compatibility — legacy automatic wiring finds two providers for one service. Automatic wiring is denied; compose and provide Layers explicitly. Replay [example: main.vibe:35:42](../../../typescript/vibelang/cases/vibelang-wire.fail/main.vibe). | 24 | [Rule chapter](005-services.md) |
| interim `EK3203` | error: legacy compiler compatibility — legacy automatic wiring finds a provider cycle. Automatic wiring is denied; compose Layers explicitly. Replay [example: main.vibe:36:23](../../../typescript/vibelang/cases/vibelang-wire.fail/main.vibe). | 24 | [Rule chapter](005-services.md) |
| interim `EK3204` | error: legacy compiler compatibility — a legacy `wire` argument's type does not expose its outputs. Automatic wiring is denied. Replay [example: main.vibe:17:25](../../../typescript/vibelang/cases/wire-spread-unlisted.fail/main.vibe). | 24 | [Rule chapter](005-services.md) |
| interim `EK3205` | warning: legacy compiler compatibility — a legacy automatically started `main` needs an unprovided service. An ordinary `main` has no automatic host invocation; run and provide its Effect explicitly. Replay [example: home.vibe:6:24](../../../typescript/vibelang/cases/ek3205-layers.fail/home.vibe). | 26 | [Rule chapter](001-functions.md) |
| interim `EK3207` | error: legacy compiler compatibility — a provider is not a `Layer`, `Context`, non-empty layer tuple or `Key = value` binding. Provide a supported operand with its checked Effect types. Replay [example: main.vibe:7:11](../../../typescript/vibelang/cases/d362-provide-any.fail/main.vibe). | 12 | [Rule chapter](005-services.md) |
| interim `EK4202` | error: legacy compiler compatibility — a TypeScript callable's legacy requirements contain a control operation. Handlers remain an open proposal.  Emission witness pending for `EK4202`: its archived control input is rejected earlier by `EK3501`. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 35 | [Rule chapter](003-failures.md) |
| interim `EK4301` | error: legacy compiler compatibility — a legacy implicit Effect callback is passed where a synchronous callback is expected. Function keywords determine their kind; use ordinary checked callback and return types. Replay [example: main.vibe:5:3](../../../typescript/vibelang/cases/discarded-effect-call.fail/main.vibe). | 1 | [Rule chapter](001-functions.md) |
| interim `EK4406` | warning: legacy compiler compatibility — a legacy trusted or throws declaration tag cannot survive the old emit transition. Current declaration output carries `@throws`; this warning describes the old transition only.  Emission witness pending for `EK4406`: the archived input does not reach this reporter on the current compiler. The registry meaning and default remain checked by the [registration host test](../../../typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go). | 4, 27, 34 | [Rule chapter](007-tooling.md) |
| interim `EK4604` | error: legacy compiler compatibility — a legacy non-async hatch body contains `await`. Hatches are retired; native async functions retain JavaScript await. Replay [example: main.vibe:12:5](../../../typescript/vibelang/cases/await-ops.fail/main.vibe). | 6 | [Rule chapter](002-running.md) |
| interim `EK4616` | error: legacy compiler compatibility — the retired `try(…)` hatch form is used. Wrap native code with `Effect.try` or `tryPromise`, then run its Effect with `try`. Replay [example: main.vibe:9:13](../../../typescript/vibelang/cases/ek4616-try-hatch.fail/main.vibe). | 5, 6 | [Rule chapter](003-failures.md) |
| interim `EK4704` | error: legacy compiler compatibility — the current lowering does not support a pattern form. This is a compiler limitation rather than authority to reject an adopted pattern. Replay [example: main.vibe:21:12](../../../typescript/vibelang/cases/match-patterns.fail/main.vibe). | 7 | [Rule chapter](004-match.md) |
| interim `EK4801` | error: legacy compiler compatibility — an Effect value is discarded as a statement. The imported `floatingEffect` rule has its single `EK38…` identity; this is the still-registered legacy port. Replay [example: main.vibe:22:3](../../../typescript/vibelang/cases/floating-program-reference.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4803` | warning: legacy compiler compatibility — multiple versions of an Effect package are loaded. The imported `duplicatePackage` rule uses its assigned `EK38…` identity. Replay [example: main.vibe:4:1; error](../../../typescript/vibelang/cases/lsrules-duplicate-package.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4804` | warning: legacy compiler compatibility — an Effect failure is a global `Error` without a distinguishing tag. Imported global-error failure/catch rules use their assigned `EK38…` identities. Replay [example: main.vibe:12:20](../../../typescript/vibelang/cases/lsrules-defaults.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4807` | warning: legacy compiler compatibility — `Layer.mergeAll` combines layers whose services depend on one another. Compose dependencies explicitly; do not apply the historical `wire` repair. Replay [example: main.vibe:63:54; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 24, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4808` | warning: legacy compiler compatibility — a `provide` block contains only another `provide` block. The imported provision lint keeps its own identity; preserve explicit Layer composition semantics. Replay [example: main.vibe:68:5; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 12, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4809` | warning: legacy compiler compatibility — every service member requires the same service. The imported leaking-requirements lint has its assigned identity. Replay [example: main.vibe:75:9; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 9, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4810` | warning: legacy compiler compatibility — an assertion removes part of an Effect's error or requirement channel. Keep the complete checked channel; imported unsafe-assertion lint has its own identity. Replay [example: main.vibe:82:10; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4811` | off by default (warning when enabled): legacy compiler compatibility — `any` or `unknown` enters an Effect channel. Legacy optional port of the imported error-context rule; default off. Replay [example: main.vibe:87:9; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4814` | warning: legacy compiler compatibility — a `Schema` class overrides its constructor. Decoding invokes the override. Imported schema-constructor lint has its own identity. Replay [example: main.vibe:101:3](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4815` | warning: legacy compiler compatibility — an Effect value is thrown as an Effect failure. Throw the intended error value or use `try` to execute the Effect; imported lint has its own identity. Replay [example: main.vibe:112:9; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 4, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4817` | off by default (warning when enabled): legacy compiler compatibility — `instanceof` tests a `Schema` class rather than schema membership. Use `Schema.is`; the optional legacy port defaults off. Replay [example: main.vibe:107:10; error](../../../typescript/vibelang/cases/lsrules.fail/main.vibe). | 38 | [Rule chapter](007-tooling.md) |
| interim `EK4840` | warning: legacy compiler compatibility — an Option pipeline can be converted to legacy extension-method syntax. Keep native Option calls or accepted matching syntax; do not introduce unsupported extension methods. Replay [example: main.vibe:5:54](../../../typescript/vibelang/cases/tsforms-option/main.vibe). | 6, 34 | [Rule chapter](007-tooling.md) |
| interim `EK4601` | error: legacy compiler compatibility — `await` before a call returning an Effect in plain code. Example: `function run() { return await Effect.succeed(1) }`. Native async functions retain JavaScript `await`; effect code rejects it with `EK0102`. | 1, 5 | [Running Effects](002-running.md) |
| interim `EK4409` | warning: legacy compiler compatibility — a legacy Effect function returns a call of a value typed `any`. Ordinary return types retain TypeScript's treatment of `any`; use `try` to obtain an Effect's success value. Replay [example: main.vibe:13:10; error; also EK0403](../../../typescript/vibelang/cases/any-call-error-recovery.fail/main.vibe). | 1, 3 | [Rule chapter](001-functions.md) |
| interim `EK4838` | error: legacy compiler compatibility — legacy ownership analysis sees a `Fiber` leave its fork region. Fibers may be returned or stored; only the parent/Scope lifetime governs interruption. The historical restriction is not normative. Replay the [stale-warning editor regression](../../../typescript/tsc/internal/vibelang/fork_escape_test.go). | 17 | [Rule chapter](002-running.md) |
| interim `EK2115` | error: legacy compiler compatibility — the stock TypeScript mapper sees an Effect-running call in a legacy factory's call-time body. The accepted language chooses function kind from its keyword; this mapper compatibility check still affects existing projections and is retained until coordinated retirement. The stock-TypeScript projection host reports this compatibility path. Example: `const make = (): Effect.Effect<number> => { Effect.log("building"); return () => 1 }`; [mapper example: factory-call](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go). | 1 | [Rule chapter](001-functions.md) |
| interim `EK4612` | error: legacy compiler compatibility — `join` appears inside a legacy hatch body. Hatches are retired; put `join` in effect code. The stock-TypeScript projection host reports this compatibility path. Example: `function f(fiber: Fiber.Fiber<number>) { return sync(() => join fiber) }`; [mapper example: join-hatch](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go). | 6, 17 | [Rule chapter](002-running.md) |
| interim `EK4819` | error: legacy compiler compatibility — an editor requests the historical missing-star repair for `yield effect`. Retained editor repair only; the compiler does not emit this code on ordinary TypeScript. The native compiler emits no such diagnostic on ordinary TypeScript; this is a retained explicit editor repair request. Example: `function* g() { yield Effect.succeed(1) }`; [editor example: yield-star](../../../typescript/tsc/internal/vibelang/diagnostic_appendix_hosts_test.go). | 34, 38 | [Rule chapter](007-tooling.md) |
| interim `EK4820` | error: legacy compiler compatibility — an editor requests the historical return repair for `yield*` of an Effect that never succeeds. Retained editor repair only; the compiler does not emit this code on ordinary TypeScript. The native compiler emits no such diagnostic on ordinary TypeScript; this is a retained explicit editor repair request. Example: `function* g() { yield* Effect.fail("x") }`; [editor example: yield-return](../../../typescript/tsc/internal/vibelang/diagnostic_appendix_hosts_test.go). | 34, 38 | [Rule chapter](007-tooling.md) |
| interim `EK9209` | error: a legacy layer setup statement follows a member. Use an explicit Layer constructor; this is the unchanged setup-order compatibility check. Replay [example: main.vibe:12:3](../../../typescript/vibelang/cases/decl-layer-order.fail/main.vibe). | 11 | [Compatibility identity examples](../../../typescript/tsc/internal/vibelang/diagnostic_compatibility_identity_test.go) |
| interim `EK9211` | error: a legacy runner or automatic wiring site lacks a required provider. Provide and run the Effect explicitly. EK3201 belongs only to the Effect version pin. Replay [example: main.vibe:28:21](../../../typescript/vibelang/cases/ek3201-runner-services.fail/main.vibe). | 24, 26 | [Compatibility identity examples](../../../typescript/tsc/internal/vibelang/diagnostic_compatibility_identity_test.go) |
| interim `EK9214` | error: a service key is called with arguments in the legacy service lowering. Read the implementation before calling it. EK3007 belongs only to configuration keys and values. Replay [example: main.vibe:13:13](../../../typescript/vibelang/cases/service-key-call-arguments.fail/main.vibe). | 9, 30 | [Compatibility identity examples](../../../typescript/tsc/internal/vibelang/diagnostic_compatibility_identity_test.go) |
| interim `EK9005` | error: the stock-TypeScript projection cannot choose a lowering from written types. Its fatal refusal keeps the former mapper behavior; native editor advice retains EK9100. [mapper example: form-choice](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go). | 34 | Add the requested annotation or compile with the native compiler. |
| interim `EK9006` | error: the stock-TypeScript projection cannot prove a data-method receiver or access form. Native editor annotation suggestions retain EK9101. [mapper example: data-method](../../../typescript/tsc/internal/vibelangmapper/diagnostic_appendix_hosts_test.go). | 34 | Add the requested receiver type or call the module function explicitly. |
| interim `EK9100` | warning: the native editor offers a written annotation for the lowering the fork infers. It is absent from ordinary compiler diagnostics. Example: an inferred callable whose projection needs an explicit Effect return type; [editor form example](../../../typescript/tsc/internal/ls/inferred_form_fix_test.go). | 34 | Apply “Annotate as the fork infers”; the fatal projection identity is EK9005. |
| interim `EK9101` | suggestion: the native editor offers the checker’s receiver type for a data-method access. Example: an inferred receiver at `todos.map()`; [editor receiver example](../../../typescript/tsc/internal/ls/inferred_receiver_fix_test.go). | 34 | Apply the receiver annotation; the fatal projection identity is EK9006. |

For example, `effect function bad(): number!! { throw new Bad() }`, with `error Bad`, fails ordinary Effect return-type checking: its error type is `Bad`, rather than `never`. `effect function run() { return try succeed(1) }` is valid and gives `Success(1)`. Removing the old statement warning never permits skipping an infallible Effect.


The compiler also prints `EK0204`, a compiler gap rather than a language rule. Where it still compiles a `do` to a function (a parameter default, a declaration in a for-loop initializer, a class member, a `case` test, an optional chain, and the `catch` expressions, `throw` expressions and `fork` it writes as functions), it rejects a `return`, `var`, jump, `await` or `yield` that would leave the `do`. The admitted completions keep the meaning [Running Effects](002-running.md#parameter-defaults) gives; ordinary placement and early-error rules still apply. In particular, `function f(x = do { return null }) {}` returns `null` from `f`; the code retires when the compiler lowers those positions.

| Code | Rule | VIP | Chapter |
| --- | --- | --- | --- |
| `EK0204` | compiler gap, not a language rule: a `return`, `var`, jump, `await` or `yield` that would leave a `do` the compiler still compiles to a function; admitted completions keep VIP-2’s meaning | 2 | [Running Effects](002-running.md#do-expressions) |

The existing migration diagnostics retain their emitted codes until the compiler and documentation move together. They select repairs; they do not change the omitted-slot or service rules.

| Code | Rule | VIP | Chapter |
| --- | --- | --- | --- |
| `EK1023` | transitional error: a block after an Effect dual that `0.0.10` ran as the dual's program, where appending it as the last argument type-checks with changed meaning; the versioned dual migration reports it instead of a duplicate `EK1101` and keeps the original argument position | 11, 34 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4853` | warning: migration of an omitted requirement slot: write the previously inferred requirements explicitly, or omit the whole return annotation to infer the contract | 3 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4854` | warning: migration of the retired abstract-class service spelling to a `service` declaration, retaining its contract and key | 9 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4855` | warning: preserving migration of a service's cached `static readonly default` to an equivalent native `Context.Service` class; retain its key, eager initialization, cached identity, field and type reads, mutable shape members and missing-provider failure, or refuse | 9 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4856` | warning: a type use resolves to the retired global `Effect<A, E, R>` alias; write `A!E!R` or `Effect.Effect<A, E, R>`; local and imported types are unchanged | 3, 14, 34 | [Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements) |
| `EK4857` | error: an immediate written `infer` channel in the [legacy return-slot set](001-functions.md#legacy-written-infer-return-slots); replaces `TS1338` for the same occurrence while the migration exists, preserving independent native errors; write the inferred channel type, or, only on an explicitly `effect`-marked callable with every channel `infer`, omit the annotation if preservation is proved | 3 | [Effect types](001-functions.md#the-aer-type-shorthand) |

An abstract class retains ordinary TypeScript class semantics until explicitly migrated. A legacy cached service default retains the native service and static field semantics described above; adoption of a Reference factory is an explicit semantic change. These diagnostics use the existing safe codemod and its refusal rules ([Configuration and tooling](007-tooling.md#compiler-and-tooling-requirements)).

### Imported lint codes

The normative [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) and this table are generated by `node docs/tools/lint-codes.mjs --write` from the vendored [`UPSTREAM`](../../../typescript/tsc/internal/effecttsgo/UPSTREAM) pin (VIP-38). [Tooling](007-tooling.md) defines severity precedence and the append-only `EK38` allocation. The decimal suffix grows past two digits when necessary; removed rule names keep their reserved codes. Codes compare as whole strings, so `EK3810` and `EK38100` are distinct; no `EK39xx` block is reserved, because that block belongs to VIP-39.

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

The old lint warning `EK4843` is retired; its entry-point warning is retired and will never be reassigned. Under VIP-26 an exported lexical `main` keeps its ordinary binding, with no entry warning or declaration-changing quick fix.

## Appendix C. Denied and open VIPs

### Denied VIPs

A denied VIP is not part of the language. Each records what was proposed and why it was denied.

| VIP | Denied | Instead |
| --- | --- | --- |
| [8](../vips/0008-using-denied.md) | special syntax for Effect resources (`using` with Effect meaning, a `scoped` keyword) | `using` is TypeScript's; Effect resources use `scoped(effect { … })` |
| [10](../vips/0010-service-call-shorthand-denied.md) | the `Users.find(id)` shorthand | `try (try Users).find(id)` |
| [11](../vips/0011-trailing-blocks-denied.md) | trailing blocks, `f(x) { … }` | `f(x, () => { … })`, `f(x, effect () => { … })` or `f(x, effect { … })`, as the proven legacy lowering chooses; refuse an unproved choice (VIP-11) |
| [24](../vips/0024-wire-denied.md) | `wire`, automatic layer composition | Effect's `Layer.provide` and `Layer.provideMerge` |

[VIP-25](../vips/0025-inline-modules-denied.md) is superseded by accepted [VIP-40](../vips/0040-module-declarations.md): named top-level `module` declarations are TypeScript escapes. Its denial is historical.

### Open VIPs

Listed for a future decision; not part of the language.

| VIP | Title |
| --- | --- |
| [35](../vips/0035-handlers-open.md) | Effect handlers (`control`, `handle`, `resume`, `abandon`) |
| [36](../vips/0036-manifest-open.md) | The declaration manifest |
| [37](../vips/0037-effectify-the-universe-open.md) | Effectify the universe |

The proposals page lists further ideas, each to get its own VIP: durable execution, compile-time evaluation, build-time host selection, validators derived from types, typed asset imports, custom loaders, Rust and Zig source imports, a coding-agent library, typed workers, shared structs, declarations in conditionals, toolchain commands, bundler plugins, mandatory compiler options and a TC39 adopt-early list.

## Appendix D. Flipping pending examples

A VibeLang example the compiler does not yet pass starts with `// compiler-gap: pending VIP-N`, and every Effect TypeScript example that names functions it doesn't declare starts with `// fragment`. The snippet checker reports a `compiler-gap` block as a known gap, not a failure.

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

These are the annotations [Thrown types](003-failures.md#thrown-types) refers to. VibeLang ships the intrinsic global annotations and the thunk annotations of VIP-4's two wrappers. An npm signature uses the library rows below only when it carries the annotation; the inventory does not supply package trust. Every other callback parameter of any function, Effect's and the globals' alike, `LazyArg` included, is a function type with no `@throws`, so it admits only non-throwing functions: `sync(() => parse(s))` is an error; use `Effect.try`.

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
| the data-last overload of every dual export of effect 4.1.1: `map(f)`, `retry(p)`, `catchTag(t, h)` | `@throws {never}`: it only builds a function |
| `new Promise(executor)` | `@throws {never}`, no `@rethrows`: a throw in the executor rejects the Promise, as in JavaScript; it never throws at the construction site |
| the `executor` parameter's call signature | `@throws {unknown}`: it admits a throwing executor, whose throw becomes the rejection, not part of the constructor's thrown type |

In a `.ts` file, `setTimeout` does not rethrow, because it stores the callback; in a `.vibe` file it is a banned platform global ([Services](005-services.md#the-platform-standard-library)). The array annotations attach to every `lib.d.ts` call signature of the named method, on `Array<T>` and `ReadonlyArray<T>` alike; a tuple uses `Array<T>`'s. An Effect function's data-first overload returns an Effect and is effectful; its data-last overload returns a function and is non-effectful. When that signature carries `@throws {never}`, `fetchUser(id).pipe(Effect.map(toDto), Effect.retry(policy))` passes the thrown-type rule; inferred-argument `EK4802` warnings still apply. Their callbacks have no `@throws`. A library declares the same tags in its own declarations:

```ts
/** @throws {never} @rethrows f */
export declare function each<T>(xs: readonly T[], f: (x: T) => void): void
```

`Schema.decodeUnknownSync(User)` and `Schema.decodeSync(User)` only build decoders and throw nothing; calling either decoder throws `SchemaError` on invalid input.

Reachability quantifies over the selected signature's receiver and parameter types; a safe literal or local range check does not change that signature's thrown type. Thus `toFixed(2)` and `repeat(81)` retain `RangeError` and use `Effect.try`, while `padStart` and `padEnd` have own thrown type `never`: their `ToLength` conversion clamps nonpositive counts, with resource limits still implicit.

Every remaining global is annotated by a generator; the same generator records proposed annotations for effect 4.1.1 non-Effect exports, without granting those library signatures an implicit contract: `@throws {never}` only when its source has no `throw` reachable from well-typed input, a named class when one is known (`SchemaError`), otherwise `@throws {unknown}`. The normative [`throws.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/throws.json) is generated by `node docs/tools/throws-inventory.mjs --write`. It records the bundled TypeScript lib version and every input file's hash, the exact Effect package version and hashes of its declarations and shipped `dist` sources. Every entry is keyed by `module`, `declaration`, `kind` and `signature`, with `ownThrows`, `rethrows`, `callbacks` and `returns` contracts; non-callable values have `ownThrows: null`. Native argument-validation contracts follow [Implicit and tracked built-in throws](003-failures.md#implicit-throws); source analysis follows imported helpers and constructors, separates returned function bodies and treats incomplete proofs as `unknown`. Function-type callbacks admit `never` by default, while the explicit wrapper thunks, Promise executor and rethrowing parameters carry their admitted thrown type. Native proofs use finite sets of known methods; unmodeled APIs remain `unknown`. Iterable protocol hooks are implicit for `Array.from(it)`, `new Map(it)` and `new Set(it)`. Numeric `dual` arities distinguish a data-last factory, whose own thrown type is `never`, from a full invocation of its body; the returned callable keeps that body's contract. Dynamic arity predicates need a separate proof and stay conservative. `Effect.catchTag`'s data-last factory has thrown type `never`; its shipped selector only tests `isEffect`. The JavaScript `dist` files erase parameter types, so scalar-call proofs require known safe arguments or an intrinsic that accepts every value. Unresolved iterator protocols, disposal, tagged-template calls and computed method keys remain `unknown` rather than a guessed `never`. A TypeScript or Effect bump regenerates this artifact; `node --test docs/tools/throws-inventory.test.mjs` rejects stale output. An npm signature follows the single external-callable rule in chapter 003: its written annotation, or `unknown` without one, subject to the ordinary effectful-return rule. Source-analysis inventory entries do not override that rule. `@throws` and `@rethrows` attach to a call signature, as TypeScript attaches JSDoc to each overload, so a returned function's contract sits on its own signature:

```ts
import type { Schema } from "effect"

export declare function decodeUnknownSync<T>(s: Schema.Decoder<T>): {
  /** @throws {Schema.SchemaError} */ (input: unknown): T
}
```
