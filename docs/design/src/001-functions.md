# Functions and Effect types

Sources: [VIP-1](../vips/0001-effect-and-async-functions.md), [VIP-4](../vips/0004-throw.md) (legacy JavaScript), [VIP-3](../vips/0003-effect-type-shorthand.md), [VIP-26](../vips/0026-top-level-and-main.md), [VIP-27](../vips/0027-declaration-output.md).

A function's kind is decided by a keyword on the function, never by its body or by a type. There are three kinds:

| Kind | Written | Calling it gives | Inside it |
| --- | --- | --- | --- |
| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |
| `async` | `async function f() { }`, `async () => …`, `async m() { }` (a method) | a Promise, as in TypeScript | `await` waits for a Promise |
| `effect` | `effect function f() { }`, `effect () => …`, `effect m() { }` (a method) | an Effect, not yet run | `try` runs an Effect |

## `effect` functions

### Syntax

[EffectFunction](900-appendices.md#effectfunction), [EffectArrow](900-appendices.md#effectarrow) and [EffectMethod](900-appendices.md#effectmethod). [ArrowParams](900-appendices.md#arrowparams) is TypeScript's parenthesized `async`-arrow parameter list, and [Modifiers](900-appendices.md#modifiers) are its class-member modifiers. As for `async`, `effect x => …` is allowed; only a parenthesized arrow head may have type parameters or a return annotation. `export` and `export default` come before `effect function` through ECMAScript's `ExportDeclaration`, as before `async function`.

- `effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1), apart from the `effect { … }` block (VIP-2). [Name](900-appendices.md#name) is optional where it is optional for `async function`: required in a declaration except `export default effect function () { }`, optional in an expression.
- There is no top-level shorthand: `effect load() { }` and `async load() { }` outside a class or object literal are syntax errors, with a quick fix that inserts `function`. At a statement start or after `export`, `effect` or `async` followed by a name other than `as`, `satisfies` or `is`, then `(` or `<`, parses so this rule can report it. `effect as (Handler)` stays TypeScript's type assertion. `EK0101`.
- As for `async`: type parameters follow the name, as in `effect m<T>(x: T) { }` and `effect function f<T>(x: T) { }`; `static effect m()` and a private `effect #load() { }` are allowed; getters, setters and constructors can't be `effect`; and `effect() { }` alone is a method named `effect`.
- A recognized `effect` modifier in a TypeScript-forbidden `async` position is `EK0108`: on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member. Recognition follows syntax, including TypeScript’s recovery positions; ordinary TypeScript syntax keeps its own diagnostics. Valid function/class overload signatures retain TypeScript’s ordinary rules. A method named `effect`, such as `interface Ordinary { effect(): number }`, has no Effect modifier.
- `effect get x() { }` and `effect set x(v) { }` parse, so the getter/setter rule below reports them, as TypeScript parses `async get x() { }` and reports TS1042.
- `effect` and the function, name or parameters it modifies are on one line, and an arrow's `=>` is on the line its parameters end, as with `async`.
- Anywhere else, `effect` is an ordinary identifier, so `Layer.effect(…)` and `const effect = …` keep working. As with `async`, an arrow needs its whole head: `effect(x) => …` is an arrow, and `effect(x)` without `=>` is a call.
- A decorator list precedes the class modifiers, as for `async` methods; object-literal methods have no decorators. An `effect` function declaration or class method may have bodyless overload signatures wherever TypeScript admits the corresponding `async` signatures, with its ordering, adjacent-implementation, compatibility and semicolon rules. Function expressions, object-literal methods and arrows require bodies. A starred overload signature keeps TypeScript’s `TS1222`, as `async *m(): S;` does; `abstract effect` methods and ambient `effect` declarations are `EK0108`, above. A signature without a return annotation exposes `any`, as a bodyless `async` signature does, with TypeScript’s `TS7010` under `noImplicitAny`. It is not inferred from the implementation; write the Effect type to give the signature a checked contract.
- `effect function*` declares a producer ([Running Effects](002-running.md#producers)).

`effect` and `async` on one function or block, in either order, is a compile error (`EK0105`; VIP-1/VIP-2). Both orders parse as an [EffectModifier](900-appendices.md#effectmodifier), so this code is reported instead of a generic syntax error. A function’s quick fixes remove one modifier. A block’s quick fix removes `async`, retaining `effect { B }`; `async { B }` is not admitted. No Effect TypeScript counterpart combines an `Effect.gen` with a Promise-returning `async` function.

```vibe es
// compiler-gap: pending VIP-1, VIP-2
effect async function f() { }   // EK0105: pick effect or async
async effect function g() { }   // EK0105
const h = async effect () => 1  // EK0105
class K { async effect get x() { return 1 } }   // EK0104 and EK0105
const a = effect async { return 7 } // EK0105: remove async
const b = async effect { return 7 } // EK0105: remove async
```


```vibe es
// compiler-gap: pending VIP-1
// Arrow-head syntax controls
const f: (x: number) => (number!!) = effect x: number!! => x // syntax error: parenthesize x
const g: (x: number) => (number!!) = effect <T> x => x       // syntax error: parenthesize parameters
const a: (x: number) => (number!!) = effect (x): number!! => x // allowed
const b = effect <T>(x: T) => x                              // allowed
const c: (x: number) => (number!!) = effect x => x             // allowed
```


```vibe es
// compiler-gap: pending VIP-1
effect function pick(x: string): string!!;
effect function pick(x: number): number!!;
effect function pick(x: string | number) { return x }
class Choices {
  effect pick(x: string): string!!;
  effect pick(x: number): number!!;
  effect pick(x: string | number) { return x }
}
```

The exposed signatures remain separate in declaration output. Their Effect TypeScript counterpart gives `Success(["ok", 7])`; only the implementations execute bodies:

```ts effect
// Overload-position counterpart
import * as Effect from "effect/Effect"
function pick(x: string): Effect.Effect<string>;
function pick(x: number): Effect.Effect<number>;
function pick(x: string | number) { return Effect.gen(function* () { return x }) }
class Choices {
  pick(x: string): Effect.Effect<string>;
  pick(x: number): Effect.Effect<number>;
  pick(x: string | number) { return Effect.gen(function* () { return x }) }
}
const result = Effect.runSync(Effect.gen(function* () {
  return [yield* pick("ok"), yield* new Choices().pick(7)]
}))
console.log(JSON.stringify(result))
```

A signature without a return annotation exposes `any`, as the `async` signature does:

```vibe es
// compiler-gap: pending VIP-1
effect function untyped(x: string);            // TS7010 under noImplicitAny; exposes any
effect function untyped(x: string) { return x }
effect function typed(x: string): string!!;
effect function typed(x: string) { return x }
```

```ts effect
// Unannotated overload counterpart
import * as Effect from "effect/Effect"
// @ts-expect-error: TS7010, the signature lacks a return annotation
function untyped(x: string);
function untyped(x: string) { return Effect.gen(function* () { return x }) }
function typed(x: string): Effect.Effect<string>;
function typed(x: string) { return Effect.gen(function* () { return x }) }
const exposed: number = untyped("ok") // any: the implementation does not type the signature
```

The forbidden modifier positions have their own code; ordinary identifier names remain available:

```vibe
// compiler-gap: pending VIP-1
abstract class Bad { abstract effect read(): number!! } // EK0108
declare effect function ambientRead(): number!!         // EK0108
interface BadMember { effect read(): number!! }         // EK0108
type BadLiteral = { effect read(): number!! }            // EK0108
interface BadProperty { effect value: number }          // EK0108
class Starred { effect *m(): Stream.Stream<number>; effect *m() { yield 1 } } // TS1222
interface Ordinary { effect(): number }                 // a method named effect
class OrdinaryValue { effect(): number { return 1 } }   // a method named effect
```

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block; or `await` in directly evaluated formal-parameter initialization of an Effect function, arrow, method or producer | `EK0102` |
| `await` on an Effect, by the [Result test](002-running.md#result-tests) (VIP-5, amended: not `never`, `any` or `unknown`, and at least one union member an Effect), in an `async` function or at the module top level (VIP-5); write `await runPromise(e)` | `EK0103` |
| `effect` on a getter, setter or constructor | `EK0104` |
| `effect` and `async` on one function or block | `EK0105` |
| a recognized `effect` modifier on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member | `EK0108` |
| A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`, an alias included, as TS1064 requires `Promise<T>` for `async` (`any`, `unknown` and `never` are errors) | `EK0106` |
| A banned use of `eval`, `Function`, `arguments`, `var` or `with` anywhere in a `.vibe` file, plain functions included, as [Legacy JavaScript](#direct-eval) defines it | `EK0107` |

```vibe es
// compiler-gap: pending VIP-1
async function a() { await main() }                 // EK0103: write await runPromise(main())
async function b(x: any) { return await x }         // ok: any is not an Effect for EK0103
effect function n(): number { return 1 }            // EK0106: write number!! or leave it out
```

`new f()` on a `.vibe` function gets TypeScript's own error only, with no VibeLang check (VIP-1, amended).

"Inside" means the innermost enclosing function, as for `await` in JavaScript: a plain arrow written inside an `effect` function is a plain function, and `try` is an error inside it.

`try` works like `await`, so an `effect` function's parameter list, a class field initializer and a `static` block are not effect code, as `await` can't appear there in an `async` function ([the grammar's Effect parameter](900-appendices.md#the-effect-parameter)). An effect construct there is that construct's "outside effect code" error ([Running Effects](002-running.md#static-rules)). What a parameter default may throw is in [Code outside the generator](003-failures.md#code-outside-the-generator). An `is` pattern cannot introduce a binding whose lexical home would be formal-parameter initialization (`EK0705`); binding-free tests and explicit block-local bindings follow [Pattern matching](004-match.md#is-bindings-in-parameter-initialization).

Class field and enum member initializers reset the Effect reservation context, so ordinary calls to identifiers named `fork` or `join` stay ordinary calls there. Static blocks inherit the surrounding reservation but stay outside Effect execution: `join(x)` in a class written in that reserved context receives `EK1701`; a static block in a plain context can call an ordinary `join`. Heritage and computed class element names keep their enclosing context, and a nested explicit Effect callable or block starts its own. [Appendix A](900-appendices.md#the-effect-parameter) states this rule and VIP-17’s outside-code identifier promise.

Forbidden `await` in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`; forbidden `yield` there is `EK2104`. This does not make parameter initialization effect code: `try` keeps `EK0501`. Stop at a nested source callable or context boundary; an ordinary async callable or native generator keeps its own `await` or `yield` rules. Defaults, destructuring defaults and computed binding keys follow the same boundary ([parameter examples](002-running.md#parameter-defaults)).

### Meaning

Calling an `effect` function returns its Effect unrun, as calling an `async` function returns a Promise. Running that Effect runs the body.

```vibe es
// compiler-gap: pending VIP-1
effect function load(id: string) { return try fetchUser(id) }
const loadArrow = effect (id: string) => try fetchUser(id)
const loadBare = (ids: string[]) => ids.map(effect id => try fetchUser(id))
const loadAll = (ids: string[]) => ids.map(effect function (id) { return try fetchUser(id) })

class Users {
  effect find(id: string) { return try fetchUser(id) }
  async load(q: string) { return await queryDb(q) }
}
```

```ts effect
// fragment
function load(id: string) { return Effect.gen(function* () { return yield* fetchUser(id) }) }
const loadArrow = (id: string) => Effect.gen(function* () { return yield* fetchUser(id) })
const loadBare = (ids: string[]) => ids.map((id) => Effect.gen(function* () { return yield* fetchUser(id) }))
const loadAll = (ids: string[]) => ids.map(function (id) { return Effect.gen(function* () { return yield* fetchUser(id) }) })

class Users {
  find(id: string) { return Effect.gen(function* () { return yield* fetchUser(id) }) }
  async load(q: string) { return await queryDb(q) }
}
```

Each form keeps the form it is written in, as `async` does. A declaration stays a hoisted function declaration, so a call above it works, from a module in an import cycle too. `B` keeps its function's `this` and `super` ([Bindings](#bindings)):

| VibeLang | Effect TypeScript |
| --- | --- |
| `effect function f(p) { B }` | `function f(p) { return Effect.gen(function* () { B }) }` |
| `effect function (p) { B }` | `function (p) { return Effect.gen(function* () { B }) }` |
| `effect (p) => { B }` | `(p) => Effect.gen(function* () { B })` |
| `effect (p) => E` (an expression body) | `(p) => Effect.gen(function* () { return E })` |
| `effect m(p) { B }`, `effect #m(p) { B }` | `m(p) { return Effect.gen(function* () { B }) }`, `#m(p) { return Effect.gen(function* () { B }) }` |
| `export default effect function (p) { B }` | `export default function (p) { return Effect.gen(function* () { B }) }` |

Parameters, defaults included, are bound when the function is called, before `Effect.gen`, as an `async` function's are bound before its body starts. If binding throws, as destructuring `undefined` does, the call returns an Effect that dies with the thrown value, as an `async` function's call returns a rejected Promise, and a producer's call returns a Stream that dies with it; the call itself never throws ([Code outside the generator](003-failures.md#code-outside-the-generator)). The table shows calls whose binding completes. [Parameter defaults](002-running.md#parameter-defaults) says what a default may do: `effect function g(x = do { return null }) { return 1 }` is a function whose call `g()` gives an Effect that succeeds with `null`. The body runs each time the Effect runs. VIP-2 fixes this meaning: `effect { … }` is `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.

<a id="bindings"></a>**Bindings.** An `effect` body reads `this`, `super` and `new.target` exactly as the same body reads them in an `async` function of the same form: the same bindings, at the same step of evaluation, with the same errors. Only the start is later. Building the Effect reads none of them, and each run reads them where the body does. A function nested in the body has its own, as in TypeScript, and an `effect` arrow or block has its enclosing function's, as any arrow does. A producer (`effect function*`, `effect *m()`) follows the same rule, as an `async function*` does ([Producers](002-running.md#producers)). How the compiler passes these bindings into the generator that `Effect.gen` takes is its choice.

| The body, in `class Derived extends Base` | Exit |
| --- | --- |
| `constructor() { const p = effect { return this }; super(); this.p = p }`, then run `p` | `Success`, the instance: building `p` read nothing |
| the same `p`, run before `super()` | `Die(ReferenceError)`, as reading `this` there throws |
| `effect { if (flag) return this; return 7 }`, run before `super()` with `flag` false | `Success(7)`: an unreached read checks nothing |
| `effect { return super[key()] }`, run before `super()` | `Die(ReferenceError)` before `key()` runs, as JavaScript reads `this` first |
| `static { this.program = effect { return super.value } }`, with `Base.value` 7 | `Success(7)`: a static block has its own `super` |
| `effect go() { return super.offset() }`, where `offset` has an own `call` property | the method runs with the instance as `this`, and `call` is never read |
| `` effect go() { return super.tag`value ${2}` } `` | the tag runs with the instance as `this` |


<a id="source-names"></a>**Source names.** Generated captures preserve the source [NamedEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-namedevaluation) context. A value-only evaluation of an anonymous function or class cannot gain a name from a private variable or assignment; preserve a name the source explicitly requests. This covers pipe topics, `do`/`match` values and completion records. The naming context must be preserved or suppressed before creation, rather than repairing `.name` afterward: a class static initializer may already have observed it. Parentheses alone do not suppress source name inference. How the compiler preserves that context is its choice. A `do` completion and an array operand are value-only positions; a lifted object property initializer keeps the property's requested name, including computed and symbol keys.

```vibe es
// compiler-gap: pending VIP-1, VIP-2, VIP-23
function readName(f: () => number) { return f.name }
effect function names() {
  const n = (() => 7) |> readName(%)
  const C = do { (class { static observed = this.name }) }
  const named = () => 7
  return [n, C.name, C.observed, named.name]
}
// Success(["", "", "", "named"])
```

```ts effect
// Source-name reference controls
import * as Effect from "effect/Effect"
function readName(f: () => number) { return f.name }
function asValue<A>(value: A): A { return value }
const names = Effect.gen(function* () {
  const n = readName(() => 7)
  const C = asValue(class { static observed = this.name })
  const named = () => 7
  return [n, C.name, C.observed, named.name]
})
console.log(JSON.stringify(Effect.runSync(names)))
```

<a id="direct-eval"></a>**Legacy JavaScript.** Five JavaScript features are compile errors anywhere in a `.vibe` file, plain functions included, each with a quick fix (VIP-1 and VIP-4, amended 2026-10-29). Code that needs one lives in a `.ts` or `.js` file.

| Banned | What the rule matches | Quick fix |
| --- | --- | --- |
| `eval` | every `IdentifierReference` named `eval`: a direct `eval(s)` as ECMAScript defines it, and indirect uses such as `(0, eval)(s)`, `eval?.(s)` and `const e = eval` | move the code to a `.ts` or `.js` file |
| `Function` | every `IdentifierReference` resolving to the global `Function` constructor, except the right operand of `instanceof` (VIP-1, amended) and the object of a statically named `prototype` access, `Function.prototype`, `Function?.prototype` or `Function["prototype"]` (VIP-1, amended): `new Function("a", "return a")`, `Function("return 1")`, `Function?.(s)`, `const F = Function`, `Function.call(null, "return 7")`, `Function.name`. `x instanceof Function` and `Function.prototype.toString.call(f)` are allowed; the type `Function`, as in `const f: Function = g`, stays TypeScript's | move the code to a `.ts` or `.js` file |
| `arguments` | every `IdentifierReference` named `arguments` | a rest parameter |
| `var` | every `var` declaration, `for (var …)` included | `let`, or `const` when the binding is never assigned |
| `with` | every `with` statement (already an early error in strict code, which a module is) | rewrite the property reads |

Property names on ordinary objects, such as `o.arguments`, `o.eval` and `{ var: 1 }`, are names, not references, and are unaffected. Three more rules close the other ways to reach these globals (VIP-33 and VIP-1, amended):

- **`globalThis`** may appear only as the object of a statically named member access: `.name`, `?.name`, `["name"]` or `` [`name`] `` with no substitutions. A member `eval` or `Function` is the global itself, so `globalThis.eval(s)` and `globalThis["Function"]("return 1")` are `EK0107`, with the two `Function` exemptions above: `x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed. A banned platform member is `EK4402` ([Services](005-services.md#the-platform-standard-library)). Every other use of `globalThis` is `EK0107`: a computed key that is not such a literal (`globalThis[k]`), an alias (`const g = globalThis`), destructuring (`const { eval: e } = globalThis`), an argument (`Reflect.get(globalThis, k)`), a spread, or the right operand of `in`. `typeof globalThis` in a type stays TypeScript's.
- **`.constructor` of a function.** Reading a property named `constructor` from a value whose static type is a function type or `Function` is `EK0107`: `(async () => {}).constructor` reaches the `AsyncFunction` constructor. `constructor` on other objects, and on values typed `any`, is unaffected.
- **Code in a specifier.** A string-literal `data:` or `blob:` specifier, in `import(…)` or an `import` declaration, is `EK0107`: it runs a string as code. `import(expr)` with a computed specifier is not checked; it loads a module and can't reach `eval` or `Function`.

With these five uses gone, no lowering has to hide its generator or generated names from evaluated code, and every declaration in a body is block-scoped or a parameter, so no lowering lifts a binding out of a block. [Region bodies](002-running.md#region-bodies), [Evaluation order](002-running.md#evaluation-order), [Pattern matching](004-match.md) and [Runtime guarantees](008-runtime.md) refer to this rule. Inline `module` declarations stay denied ([VIP-25](../vips/0025-inline-modules-denied.md)).

```vibe es
// compiler-gap: pending VIP-1
effect function count(x: number) { return arguments.length }   // error: `arguments` in a .vibe file
effect function count2(...xs: number[]) { return xs.length }   // write a rest parameter
function total(xs: number[]) { var t = 0; for (const x of xs) t += x; return t }   // error: `var`; write `let t = 0`
const F = Function                                              // error: an alias reaches the constructor
const r = globalThis.eval("1")                                  // error: indirect eval
const isFn = (x: unknown) => x instanceof Function               // allowed
const isFn2 = (x: unknown) => x instanceof globalThis.Function   // allowed
const g = globalThis                                            // error: an alias of globalThis
const AF = (async () => {}).constructor                         // error: reaches a Function constructor
const m = import("data:text/javascript,export default 1")       // error: a string run as code
```

```ts effect
// fragment
function count2(...xs: number[]) { return Effect.gen(function* () { return xs.length }) }
```

`count2(1, 2, 3)` succeeds with 3.

```vibe es
// compiler-gap: pending VIP-1
class Counter extends Base {
  n = 7
  effect value() { return this.n + super.offset() }
}
```

```ts effect
// fragment
class Counter extends Base {
  n = 7
  value() {
    const offset = () => super.offset()   // an arrow keeps super and this, as an async body does
    return Effect.gen({ self: this }, function* () { return this.n + offset() })
  }
}
```

With `Base.prototype.offset` returning 30, `value()` succeeds with 37.

### Return types

An `effect` function's return type is an Effect, as an `async` function's is a Promise. It can be written, or left out and inferred:

```vibe es
// compiler-gap: pending VIP-1
effect function load(id: string): User!NotFound!Users { return try fetchUser(id) }             // written
effect function load2(id: string) { return try fetchUser(id) }                                 // inferred: the same type
async function get(q: string): Promise<Row[]> { return await queryDb(q) }                      // as in TypeScript
```

An inferred type takes its success from what the function returns, a `return` in a parameter default included, and its errors and requirements from the Effects its body runs, exactly as `Effect.gen` infers them. So `g` in [Meaning](#meaning) returns `Effect.Effect<number | null>`. A recursive function whose type can't be inferred gets TypeScript's own TS7022, TS7023 or TS7024, and no VibeLang diagnostic (VIP-1, amended); write the return type:

```vibe es
// compiler-gap: pending VIP-1
effect function down(n: number) { return n ? try down(n - 1) : 0 }             // TS7023, TS7024
effect function down2(n: number): number!! { return n ? try down2(n - 1) : 0 } // compiles
```

```ts effect
// fragment
function down2(n: number): Effect.Effect<number> { return Effect.gen(function* () { return n ? yield* down2(n - 1) : 0 }) }
```

`down2(3)` succeeds with 0.

Plain functions have JavaScript's stack limit; recursion that must be stack-safe is written as an `effect` function. Running a recursive Effect with `try` uses Effect's stack-safe execution, as `yield*` does inside `Effect.gen` (VIP-1, amended). A plain recursion's stack overflow is an implicit `RangeError`, untracked and a defect when it occurs in effect code. The exact failing depth depends on the runtime.

```vibe es
// compiler-gap: pending VIP-1
function depth(n: number): number { return n === 0 ? 0 : 1 + depth(n - 1) }
effect function depthE(n: number): number!! {
  return n === 0 ? 0 : 1 + (try depthE(n - 1))
}
```

```ts effect
import { Effect } from "effect"
function depth(n: number): number { return n === 0 ? 0 : 1 + depth(n - 1) }
function depthE(n: number): Effect.Effect<number> {
  return Effect.gen(function* () {
    return n === 0 ? 0 : 1 + (yield* depthE(n - 1))
  })
}
```

### Crossing between Promises and Effects

No construct converts between the two. Effect's own functions do, as [VIP-6](../vips/0006-effect-globals.md) globals:

| From | To | Write |
| --- | --- | --- |
| a Promise, in an `effect` function | an Effect | `try tryPromise(() => queryDb(q))` or `try promise(() => p)` |
| an Effect, in an `async` function | a Promise | `await runPromise(load(id))` |

In these examples `queryDb` is a Promise-returning function imported from a `.ts` module with no `@throws`, so it may throw `unknown` ([Thrown types](003-failures.md#thrown-types)); `tryPromise` makes a throw or a rejection a failure. `promise(() => p)` wraps a Promise `p` already in hand that can't reject: a rejection there is a defect, so use `tryPromise` otherwise. A platform call such as `fetch` can't appear in a `.vibe` file at all, wrapped or not ([Services](005-services.md#the-platform-standard-library)).

## The `A!E!R` type shorthand

### Syntax

[EffectType](900-appendices.md#effecttype). `A!B!C` is always the three-slot form, never `(A!B)!C`; write the parentheses to nest. A line break ends an Effect type, as it ends TypeScript's postfix type operators: each `!`, and the slot after it, start on the line where the previous slot ends, and a slot in parentheses may span lines. Only the optional `R` after `!!` excludes an unparenthesized `{`; required error and requirement slots admit object types, so `): number!! {` begins the body; write `A!!({ … })` for a type-literal requirement. Otherwise, among complete source parses, prefer consuming an ordinary TypeScript source operand on that line as `R`: a negative literal type such as `-1` is consumed as `R`, so `x as A!! - 1` asserts `A!!-1`. Write `(x as A!!) - 1` for subtraction. Parser-only JSDoc type forms are excluded, including inside parentheses ([operand boundaries](900-appendices.md#effectoperand)). Directly after `A!`, where the next `!` completes `A!!`, the scanner reads that `!` as one token and rescans from the next character, as TypeScript rescans `>` after type arguments: `A!!= v` is `A!! = v`, `A!!== v` is `A!! == v`, `A!!=== v` is `A!! === v` and `(): A!!=> e` is `(): A!! => e`. Anywhere else `!=` and `!==` stay equality operators, as in TypeScript:

```vibe es
// compiler-gap: pending VIP-3
const e: User!!= load()     // const e: User!! = load()
const f = effect (x: number): number!!=> x   // effect (x: number): number!! => x
const same = e as User!!=== e  // (e as User!!) === e
if (x as number !== 0) { }  // (x as number) !== 0
interface Clock {
  now(): number!!           // two members, not R = later
  later(): number!!
}
const a: User!(
  NotFound | Timeout) = load()   // one type: the slot starts on the line of its !
```

```vibe es
// compiler-gap: pending VIP-3
const b: User!
  NotFound = load()         // syntax error (TS17019): this ! has no slot on its line
```

A line break also ends the type, so this is two statements, as in TypeScript:

```vibe es
// compiler-gap: pending VIP-3
const y = x as User
!flag && fail()
```

An enclosing optional tuple element keeps TypeScript's omission and indexed `undefined`: `[A!E?]` and `[A!!?]` mark the whole Effect element optional. [The operand boundaries](900-appendices.md#effectoperand) also distinguish optional `R` from a following comparison, element access or `as`/`satisfies` continuation. The choice is among complete source parses, with present-`R` priority and no symbol lookup; a contextual type alias named `as` or `satisfies` remains usable.

### Meaning

`A!E!R` is a type alias for Effect's Effect type, nothing more. It means exactly what that type means wherever a type can be written. VIP-3 writes the type `Effect<A, E, R>`; Effect TypeScript, and a `.vibe` file, write it `Effect.Effect<A, E, R>`, because `Effect` is the module.

| Written | Means exactly |
| --- | --- |
| `User!NotFound!Users` | `Effect.Effect<User, NotFound, Users>` |
| `User!NotFound` | `Effect.Effect<User, NotFound, never>` |
| `User!!Users` | `Effect.Effect<User, never, Users>` |
| `User!!` | `Effect.Effect<User, never, never>` |

- An omitted slot is `never`, as Effect's own defaults make it. It is never inferred, so `User!NotFound` on a function with a body still means `Effect.Effect<User, NotFound, never>`. To have the type inferred, leave the annotation out.

```vibe es
// compiler-gap: pending VIP-3
effect function load(id: string): User!NotFound!Users { return try (try Users).find(id) }
interface UserStore { find(id: string): User!NotFound }
```

```ts effect
// fragment
function load(id: string): Effect.Effect<User, NotFound, Users> { return Effect.gen(function* () { return yield* (yield* Users).find(id) }) }
interface UserStore { find(id: string): Effect.Effect<User, NotFound> }
```

`!` does not mix with `|`, `&`, conditional types, or a function or constructor type in a slot, without parentheses: each is a syntax error with a quick fix that parenthesizes (VIP-3, amended; `EK0301`). A slot holds such a type only in parentheses, as in `User!(NotFound | Timeout)`. Each slot is a type-operator-level type, as an operand of `&` is in TypeScript (`keyof A & B` is `(keyof A) & B`): `keyof`, `readonly`, `[]` and `[K]` bind tighter than `!`.

```vibe es
// compiler-gap: pending VIP-3
type T = A | B!E       // syntax error
type H = A!() => B     // syntax error (EK0301): write A!(() => B)
type U = (A | B)!E     // ok
type V = A | (B!E)     // ok
type W = A!(E1 | E2)   // ok
type K = keyof A!E     // (keyof A)!E
type L = A!E[]         // A!(E[])
type M = (A!E)[]       // an array of Effects
```

```ts effect
// fragment
type U = Effect.Effect<A | B, E>
type V = A | Effect.Effect<B, E>
type W = Effect.Effect<A, E1 | E2>
type K = Effect.Effect<keyof A, E>
type L = Effect.Effect<A, E[]>
type M = Effect.Effect<A, E>[]
```

The same rule covers a conditional type's parts, so an Effect type there is parenthesized. A function or constructor type's return is a whole type, as `() => A | B` is `() => (A | B)` in TypeScript, so `=> A!E` needs no parentheses (VIP-3, amended); `=> A!E | B` still mixes `!` and `|`:

```vibe es
// compiler-gap: pending VIP-3
type F = (id: string) => User!NotFound     // ok: (id: string) => (User!NotFound)
type G = () => A!E | B                     // syntax error: write () => (A!E) | B or () => A!(E | B)
type N = new () => A!E                     // ok
type C = X extends Y ? (A!E) : B           // ok; X extends Y ? A!E : B is a syntax error
type H = A!(() => B)                       // ok: the error slot holds a function type
interface Store { find(id: string): User!NotFound }   // ok
```

```ts effect
// fragment
type F = (id: string) => Effect.Effect<User, NotFound>
type N = new () => Effect.Effect<A, E>
type C = X extends Y ? Effect.Effect<A, E> : B
type H = Effect.Effect<A, () => B>
interface Store { find(id: string): Effect.Effect<User, NotFound> }
```

## Modules and the top level

A module's top level is ordinary JavaScript (VIP-26). Every source `.vibe` or `.vibex` file is classified as an external module before binding and checking, whether or not it has a written `import` or `export`. Its declarations are module-scoped and its source is checked as strict module code. This classification is independent of required prelude imports, `vibe.effectGlobals` and `vibe.effectModules`; no `moduleDetection` value opts it into shared script globals.

Emitted JavaScript and declaration sidecars preserve this classification, including an effective empty module marker when needed. The ordinary TypeScript module emission and host rules still apply, including diagnostics for incompatible options. Top-level `await` requires a supported module and target configuration; top-level `this` is `undefined` under an ECMAScript-module host, while other output formats retain their ordinary host behavior. Unary and multiline operands keep those configuration checks: with `module: "NodeNext"`, a CommonJS package receives `TS1309`; an ECMAScript-module package with `target: "ES2016"` receives `TS1378`. The deliberate `moduleDetection` exception is stated in [Configuration](007-tooling.md#config-files).

For example, these two source files do not share a global binding, even with `moduleDetection: "legacy"` and both prelude switches disabled:

```vibe
// a.vibe
const policySecret = 1
```

```vibe
// b.vibe
const reader = policySecret // TS2304: cannot find name
```

To share the value, `a.vibe` exports `policySecret` and `b.vibe` imports it. Adding or removing an implicit Effect use cannot change either file's scope.

- `await` at the top level is ES top-level await of a Promise. `await` on an Effect there is `EK0103`.
- `try` is not allowed at the top level, because the top level is not effect code. It is the one rule "`try` outside effect code" ([Running Effects](002-running.md#static-rules)), not a second one.
- A `try { } catch { }` statement at the top level, or in a plain or `async` function, is JavaScript's, as in TypeScript. Only effect code bans it (VIP-5).
- There is no magic entry point. A function named `main` is an ordinary function, and you run it with a runner yourself, exactly as in Effect TypeScript.

```vibe es
// compiler-gap: pending VIP-26
import { NodeRuntime } from "@effect/platform-node"
export effect function main() { try log("started") }
NodeRuntime.runMain(main())     // exactly as in Effect TS
```

or, with top-level await:

```vibe es
// compiler-gap: pending VIP-26
export effect function main() { try log("started") }
await runPromise(main())
await main()                    // EK0103: the Effect would never run
```

## Declaration output

For each `x.vibe`, the compiler writes `x.d.vibe.ts` beside it, and for each `x.vibex`, `x.d.vibex.ts` (VIP-27, VIP-39). TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc` and TypeDoc understand imports of `.vibe` files. With `vibe.sidecarDir` the sidecars sit at their sources' paths under that directory instead, and tsconfig `rootDirs` lets the same tools resolve them ([Configuration](007-tooling.md#config-files); VIP-27, amended). A package build also writes ordinary `.d.ts` files to its output directory.

`bun check` runs the project's `check` script; a script that invokes a TypeScript checker uses that checker's sidecar resolution.

- **Content.** Declarations are exactly what idiomatic Effect TypeScript would declare. Ordinary interface and object-type properties, including optional members and index signatures, keep exactly the source's written `readonly` modifiers, including in nested object types; class fields keep their written modifiers too. Each keeps its source form: a function declaration is a `declare function`, and a `const` holding an arrow is a `declare const`. A `service`, `error`, `schema`, `schema error` or `data` declaration is declared as TypeScript's declaration emit of its Effect TypeScript counterpart, which introduces a `Name_base` constant for a class-call heritage such as `Context.Service<…>()("k")`. The output imports every name the source had in scope without an import: each root module as `import { Effect, Stream } from "effect"`, each subpath namespace from its subpath, and a module whose bare name is a JavaScript global's (`Array`, `Console`) under a fresh alias, as emitted code does ([Services](005-services.md#effects-modules-are-in-scope)). A declaration writes such a name only where the source writes it: an inferred signature that a library declares with a name the file never writes keeps TypeScript's import type, so `Schema.decodeUnknownSync(Schema.String)` declares `options?: import("effect/SchemaAST").ParseOptions`. A form that stands for a module writes its name: an Effect function, `A!E!R`, `try` or a bare Effect global such as `sleep` writes `Effect`, which its Effect TypeScript imports. Nothing in it depends on `vibe.effectModules` or `vibe.effectGlobals`. The generic-`data` helper for `data Outcome<A>` is named `$Outcome$Definition`; if the module already declares that name, the compiler appends `$2`, `$3`, … and takes the first free name, so the name is the same on every build (VIP-28, amended). An `error` or `schema error` keeps its static `[Symbol.customMatcher]` member, and a declaration file that declares one begins with `/// <reference types="vibelang-runtime" />`, which declares the `Symbol.customMatcher` type, so plain `tsc` checks it and matching across packages works at run time (VIP-27, amended).
- **Specifiers.** A relative import of a VibeLang module, `./user.vibe`, is declared through its `.js` output, `./user.js`, by default: no TypeScript resolves `./user.vibe` to `user.d.ts` (D298). A package whose sources spell relative imports another way keeps that spelling with the project setting `vibelang.declarationImportStyle`: `"extensionless"` declares `./user`, `".ts"` declares `./user.ts`, and `".js"` is the default. The setting spells only the package declarations in the output directory: a source-adjacent sidecar, `x.d.vibe.ts` or `x.d.vibex.ts`, keeps the source's `./user.vibe` under every setting, which plain `tsc` resolves to `user.d.vibe.ts` under `allowArbitraryExtensions`, and JavaScript output keeps `./user.js`. A relative `./App.vibex` is declared through its JavaScript output by default, `./App.jsx` under `"jsx": "preserve"` and `./App.js` otherwise ([VIP-39](../vips/0039-vibex.md#options-output-and-declarations)); what `"extensionless"` and `".ts"` declare for it is not yet decided. Under every setting, every other specifier stays as the source wrote it, `./plain.ts` included, as `tsc` keeps it in the declaration of a `.ts` file. An import type the compiler writes itself, for a type inferred from a VibeLang module that the file does not import by that specifier, is spelled as `tsc` spells it for the file's TypeScript twin, which writes each `./x.vibe` in the setting's spelling: under `module: nodenext` with `.ts` imports allowed that is `import("./user.ts").User` whatever the file writes, and otherwise the ending `tsc` infers from the twin's imports. Any other value is a configuration error. An import the declaration file adds, such as `import { Effect } from "effect"`, takes the quotes of the file's first written import or export specifier, as an import the TypeScript language service adds does; a file with none gets double quotes. Module types a file writes through one of its own imports, `HashSet<string>` through `import { HashSet, Option } from 'effect'`, stay in one import, in the written order and quotes, and an added name joins it: `import { Effect, HashSet, Option } from 'effect'`.
- **Cyclic inferred types.** Declaration serialization retains TypeScript 5.9 and 7.0 behavior where TypeScript 7.1's [new anonymous-type cycle check](https://github.com/microsoft/TypeScript/pull/64461) would report `TS5088`: the repeated anonymous type is written as `/*elided*/ any`, without an error for that cycle. This applies to `.vibe` and `.ts` alike (VIP-27, amended). Other `TS5088` checks and ordinary recursive-inference errors `TS7022`, `TS7023` and `TS7024` remain unchanged.

- **Producer environments.** An inferred producer declaration exposes the environment `Exclude<RBody, Scope.Scope>` for its body requirements `RBody`, because the accepted `Stream.callback` provides `Scope`. Preserve other services, ordinary checks on explicit annotations and values of type `Scope.Scope` ([Producers](002-running.md#producers)).
- **Thrown types.** Each declaration carries its thrown type as [Thrown types](003-failures.md#thrown-types) defines it. An effectful function carries no `@throws`. Every other call signature the output emits carries `@throws {T}`, `@throws {never}` included, so no reader depends on a default: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias (VIP-4, amended). A bare function type (`() => string`) stays a function type. Getters and setters carry none.
- **Each call signature carries its own contract** ([Thrown types](003-failures.md#thrown-types), VIP-4, amended): every overload, and a returned callable's own signature. TypeScript attaches JSDoc to a call signature but not to a function type, so a callable `const` is declared with a type literal whose call signature carries the tag. A written `@throws {T}` is a checked upper bound, so the output copies `T`; otherwise it writes the inferred type. A tag on an alias of a function type does not attach to its call signature; write `type Reader = { /** @throws {E} */ (): string }` instead (VIP-4, amended). A foreign callable binding without a tag on itself or its declared call signature throws `unknown`, whether imported from source or an emitted `.d.ts`, even with a written function type (VIP-4, amended).
- **`@rethrows` is copied and adds to own throws.** A source `/** @rethrows <param> */` tag (VIP-4) is written, never inferred, and the output copies it. For a non-effectful callable, first determine its own thrown type: a written checked bound, else a shipped signature annotation, else local body inference or the foreign/type-position default. Shipped annotations are installed before defaults apply. At each call, union that type with the thrown types of the arguments for every `@rethrows` parameter (VIP-4, amended). Thus `@throws {never}` describes only own throws; it does not erase `@rethrows f`. Effectful callables have synchronous thrown type `never`, and `@rethrows` adds nothing.
- **Local overload implementations satisfy every exposed overload.** Check the tracked synchronous throws of a local implementation, including parameter/default initialization, against every exposed overload bound, for methods too. An overload returning wholly Effect, Stream or Layer contributes the implicit `never` synchronous bound even though its output has no throws tag. A mixed-return implementation cannot hide a known throw behind that overload; a violation is `EK0401`. A plain overload keeps its written bound or existing inference/default rules. The initial check uses one conservative implementation bound; it does not silently specialize by argument. Foreign signatures retain their declared contracts without a runtime wrapper.
- **Callback admission survives a callable boundary.** A `@rethrows` parameter that admits arbitrary throwing callbacks has an admitted thrown bound of `unknown` outside the annotated callable's direct synchronous rethrow propagation. Preserve it when returning, storing or assigning the callback, or capturing/invoking it in a nested callable, including a returned object callable member or an immediately invoked nested function. A nested plain callable that may invoke the capture carries `@throws {unknown}` on its own emitted signature. Assignment to a nonthrowing destination is `EK0402`; an unwrapped invocation in effect code is `EK0403`. Merely returning or storing the callback is not an invocation. Direct synchronous invocation/forwarding keeps the own-throws-plus-actual-callback calculation above; async and effect boundaries keep their existing rules.

The recursive builder below has the same ordinary TypeScript counterpart. Its inferred declaration contains `named: (value: string) => /*elided*/ any`.

```vibe es
// compiler-gap: pending VIP-1, VIP-27
export const from = (value: string) => makeBuilder({ value })
const makeBuilder = (state: { value: string }) => ({
  state,
  named: (value: string) => makeBuilder({ value })
})
```

```ts effect
export const from = (value: string) => makeBuilder({ value })
const makeBuilder = (state: { value: string }) => ({
  state,
  named: (value: string) => makeBuilder({ value })
})
```

```vibe es
// compiler-gap: pending VIP-4, VIP-27
function choose(mode: true): number!!;
function choose(mode: false): number;
function choose(mode: boolean): (number!!) | number { throw "boom" }
// EK0401: the true overload promises never to throw synchronously.
/** @rethrows f */
export function later(f: () => number) { return () => f() }
const delayed = later(() => { throw "callback" })
const unsafe: () => number = delayed      // EK0402: returned signature throws unknown
effect function bad() { return delayed() } // EK0403
effect function good() { return try Effect.try({ try: () => delayed(), catch: (e) => e }) }
```

The returned declaration carries its own bound, for example `export declare function later(f: () => number): { /** @throws {unknown} */ (): number }`, with the outer callable's own throws and written `@rethrows f` preserved separately. Ordinary TypeScript accepts the overload signatures below; VibeLang adds the synchronous-contract check. The native references show the hidden throw as `Die("boom")`, the unwrapped callback as `Die("callback")`, and the explicit wrapper as `Fail("callback")`:

```ts effect
// Callable-contract reference witnesses
import { Effect, Exit } from "effect"
function choose(mode: true): Effect.Effect<number>;
function choose(mode: false): number;
function choose(mode: boolean): Effect.Effect<number> | number { throw "boom" }
function later(f: () => number) { return () => f() }
const delayed = later(() => { throw "callback" })
const hidden = Effect.runSyncExit(Effect.sync(() => choose(true)))
const unwrapped = Effect.runSyncExit(Effect.gen(function* () { return delayed() }))
const wrapped = Effect.runSyncExit(Effect.gen(function* () {
  return yield* Effect.try({ try: () => delayed(), catch: (e) => e })
}))
function reason(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) return ["Success", exit.value]
  const r = exit.cause.reasons[0]
  return r._tag === "Die" ? ["Die", r.defect] : r._tag === "Fail" ? ["Fail", r.error] : ["Interrupt"]
}
console.log(JSON.stringify([reason(hidden), reason(unwrapped), reason(wrapped)]))
```

Ordinary nongenerator `async` callables use the [normalized async contract](003-failures.md#async-contracts) instead of copying a synchronous `@rethrows` tag: the declaration keeps callback admission with a parameter callable `@throws {unknown}` and callee `@throws {never}`, so source and sidecar calls agree.

- A plain `.vibe` function that returns an Effect, a Stream or a Layer is effectful, so it can't throw (VIP-4, amended: an effectful function cannot throw; the later "`try` only in effect code" amendment lets plain non-effectful functions throw) ([Effectful callables](003-failures.md#effectful-callables)):

```vibe es
// compiler-gap: pending VIP-4
export function bad(id: string) { if (!id) throw new BadInput(); return fetchUser(id) }   // error: can't throw
export function load(id: string): User!(NotFound | BadInput) { return id ? fetchUser(id) : fail(new BadInput()) }
```

```ts effect
// fragment
export function load(id: string): Effect.Effect<User, NotFound | BadInput> { return id ? fetchUser(id) : Effect.fail(new BadInput()) }
```

`load("")` fails with `BadInput`; `load("u")` runs `fetchUser("u")`.

```vibe es
// compiler-gap: pending VIP-27
// load.vibe
export effect function load(id: string) { return try fetchUser(id) }
export function users(ids: string[]) { return Stream.fromIterable(ids) }
export function parse(s: string) { if (!s) throw new BadInput(); return s }
export const add = (a: number, b: number) => a + b
export async function get(q: string) { if (!q) throw new BadInput(); return await queryDb(q) }
export class Id {
  constructor(readonly s: string) { if (!s) throw new BadInput() }
  get size() { return this.s.length }
}
/** @rethrows f */
export function each(xs: string[], f: (s: string) => void) { xs.forEach(f) }
export interface Store { find(id: string): string }
```

```ts effect
// fragment
// load.d.vibe.ts
import { Effect, Stream } from "effect"
export declare function load(id: string): Effect.Effect<User, NotFound, Users>   // effectful: no @throws
export declare function users(ids: string[]): Stream.Stream<string>              // effectful: no @throws
/** @throws {BadInput} */
export declare function parse(s: string): string
export declare const add: {
  /** @throws {never} */
  (a: number, b: number): number
}
/** @throws {never} */
export declare function get(q: string): Promise<Row[]>
export declare class Id {
  readonly s: string
  /** @throws {BadInput} */
  constructor(s: string)
  get size(): number
}
/** @throws {never} @rethrows f */
export declare function each(xs: string[], f: (s: string) => void): void
export interface Store {
  /** @throws {never} */
  find(id: string): string
}
```

The emitted `each` contract above preserves callback throws at a foreign call site:

```vibe es
// compiler-gap: pending VIP-4
import { each } from "./load.vibe"
effect function direct() {
  each(["x"], () => { throw "callback" })   // EK0403: invocation throws "callback"
}
effect function wrapped() {
  return try Effect.try(() => each(["x"], () => { throw "callback" }))
}
```

```ts effect
// fragment
/** @throws {never} @rethrows f */
function each(xs: string[], f: (s: string) => void) { xs.forEach(f) }
function wrapped() {
  return Effect.gen(function* () {
    return yield* Effect.try(() => each(["x"], () => { throw "callback" }))
  })
}
```

`wrapped()` fails with `Cause.UnknownError` whose `cause` is `"callback"`. An unwrapped JavaScript call inside `Effect.gen` would defect; the source `direct` is rejected rather than silently admitting that defect.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 129

**Binding helpers stay inside the lexical environment that supplies their this/super/new.target.** (live `001-static-super-hoist`; VIP-1/VIP-2, refines 001's helper-placement recipe.) A class static block is an eligible source environment for helpers used by effect arrows/blocks constructed within it. Declare its lexical super accessor inside that static block, never at module scope or in an enclosing factory function that lacks that super binding. Preserve existing in-place class-field/parameter-default treatment. Constructing an accessor is eager, but invoking it and reading the actual super property occurs only where the cold source body does. Use the appropriate source environment for each captured binding; do not blindly hoist every helper to the nearest non-arrow function.
    Status: applied in main 0a207dbf, revalidated by spec-fix-a against the source binding rule, explicit import-cycle hoisting sentence and the five passing native binding tests. Earlier helper-recipe fixes are superseded; no duplicate patch.
    ```vibe
    class Base { static value = 7 }
    class Derived extends Base {
      static program: number!!
      static { this.program = effect { return super.value } }
    }
    const value = await runPromise(Derived.program) // 7
    ```
    Effect TS: inside the static block, `const getSuper = (k: "value") => super[k]; this.program = Effect.gen(function* () { return getSuper("value") })`. Decided by the agent from principle 2 (TypeScript's lexical super environments), VIP-1/VIP-2's source-binding guarantee, and principle 4 (environment-driven helper placement instead of an expanding list of hoisting exceptions), 2026-10-29. Apply to 001 and its 002/008 cross-references; no source restriction.

### Detail 138

**A local overloaded implementation satisfies every exposed signature's synchronous throws bound.** (live `001-overload-effectful-contract`; VIP-4/VIP-27, extends details 36/38/45/66/115.) A wholly Effect/Stream/Layer overload contributes the implicit `never` synchronous bound even though its declaration emits no throws tag. Check the local implementation's tracked synchronous throws, including parameter/default initialization, conservatively against every exposed overload bound. A mixed-return implementation cannot hide a known throw behind an effectful selected overload. Report `EK0401` for a violation. An explicit plain-overload @throws is its ordinary checked upper bound; an unannotated plain overload retains inference/default rules. Apply to methods too, preserving per-signature metadata in declaration output.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source receipt (695576, 138).** Verified at immutable main `695576acb44b`: 001/003/AppendixB state the conservative implementation-throws bound against every exposed overload, including the implicit never bound of an effectful overload. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in ababa10f87d9 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    function choose(mode: true): number!!
    function choose(mode: false): number
    function choose(mode: boolean): Effect.Effect<number> | number { throw "boom" }
    // EK0401: implementation may synchronously throw, but the true overload promises never
    ```
    Effect TS: the signatures themselves are ordinary TypeScript; VibeLang adds the VIP-4 contract check. Construct a throwing ordinary function through `Effect.try` instead of publishing an effectful never-throws overload over that implementation. The initial checker uses one inferred implementation thrown bound; argument-specialized inference may relax this later, but is not required or silently assumed. Foreign signatures retain their trusted declared effectful contract; no runtime wrapper is inserted. Decided by the agent from principle 6 (an effectful signature cannot throw), principle 8 (a known throw must not be lost at overload selection), and VIP-27's per-signature declaration guarantee, 2026-10-30.

Landing receipt: source ababa10f87d9 landed in main 695576acb44b (queue 1793371604-spec-fix-a, gate mq-10302026-7).

### Detail 139

**Effect class methods retain TypeScript's decorator prefixes and placement.** (live `001-effect-method-decorators`; audit 001 interactions m1; source correction queued as `b1788126aa66`, spec-fix-a.) The grammar accepts the same decorator list as TypeScript on class effect methods/producers, in the same class-element position. Preserve ordinary TypeScript decorator checking/evaluation on the generated ordinary Effect/Stream-returning method; the compiler does not execute the cold body while applying it. Do not admit decorator lists on object-literal methods or other positions TypeScript forbids. Parsing a decorated effect accessor for its existing accessor diagnostic does not legalize effect accessors.
    **Immutable-main source receipt (695576, 139).** Verified at immutable main `695576acb44b`: 001/AppendixA include class decorator prefixes/class-versus-object placement and overload-related method classification. This verifies the source-prefix portion; later decorator expression evaluation/emitter conformance remains separate. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in 2a1c089083b1 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    class Repo {
      @trace
      effect load() { return 1 }
    }
    ```
    Effect TS: `class Repo { @trace load() { return Effect.gen(function* () { return 1 }) } }`. Decided by the agent from principle 2 (TypeScript class-element modifiers and decorator semantics), VIP-1's method counterpart, and principle 4 (no decorator-specific execution rule), 2026-10-30. The claimed fix already has source-admission and coldness receipts; this decision records its rule, not a claim that its queued source or forms checks have landed.


    **Round26 decorator-position clarification (Opus m37):** include decorator expressions in 002's execution-position table. Evaluate them in their enclosing source context, just like class heritage/computed keys: `@(try d)` is allowed when that evaluation occurs inside an Effect activation; a plain outer function gains no permission merely because the decorated method is effectful. Existing default/field/static/plain-callable exclusions still apply at their actual source boundary. Preserve native decorator evaluation/application order and coldness. TypeScript 5.9.3 accepts `@(await Promise.resolve(mark))` in an async enclosing function and `@(yield* Effect.succeed(mark))` in a generator, and rejects the direct plain-function await control. Its ordinary ES2022 decorator emitter moves those suspension expressions into generated static blocks and emits invalid JavaScript. `round26-reference.log` records that emitter limitation plus successful simple phase-preserving controls; it is source/checker/reference evidence, not a claim that raw TypeScript emit or the VibeLang compiler implements the rule. A simple no-heritage/no-computed-key fixture may evaluate the decorator to a local first; this is not a general hoist-across-class-evaluation recipe. Decided by the agent from VIP-1's native source-context rule, principle 2 (TypeScript decorator expression admission), and principle 4 (source boundaries before generated static blocks), 2026-10-30.

    Applied in 732ad472f25a (spec-fix-b, bookmark 42); landed in main 77510050781c.

    **Independent decorator receipt:** `root-try-turn-reference.log` and `root-try-decorator-literal-emission.stderr` independently reproduce the pinned checker/emitter distinction and execute both simple captured counterparts. This corroborates the existing round26 clarification above; it is not new source-admission policy or VibeLang conformance.

Landing receipt: source 2a1c089083b1 landed in main 695576acb44b (queue 1793370440-spec-fix-a, gate mq-10302026-7).

### Detail 148

**Generated intrinsic captures are initialized before cyclic consumers can invoke hoisted exports.** (live `001-cyclic-apply-tdz`; VIP-1/VIP-26.) A hoisted exported effect declaration cannot acquire a generated module-const TDZ that its source did not have. Supply captured apply and other helpers through an acyclic runtime-helper dependency initialized before source imports can execute cyclic consumers, or an equivalent ordering with the same availability guarantee. Audit every generated module capture used by hoisted exports. Textually putting a const before an import does not establish this order. Retain captured intrinsic calls and do not read the callee's own call/apply property or replace the snapshot with a late mutable Reflect.apply lookup.
    Related cache-counterpart follow-up: spec-fix-c reports c9b989606ad1c6ad093cf5ad264c7e6544f0e7d2 queued; this removes the remaining mutable-helper example. It is not a new main landing receipt or a reversal of the separate binding/cache status below.
    Status: applied in main 0a207dbf, revalidated by spec-fix-a against the source binding rule, explicit import-cycle hoisting sentence and the five passing native binding tests. Earlier helper-recipe fixes are superseded; no duplicate patch.
    ```vibe
    import "./consumer.ts" // may call and run program during this module's dependency evaluation
    export effect function program() {
      class Base { ping() { return 7 } }
      class Derived extends Base { effect go() { return super.ping() } }
      return try new Derived().go()
    }
    ```
    Effect TS: the same hoisted function, with apply imported from a noncyclic helper dependency evaluated before consumer.ts; the executed reference succeeds with 7 instead of a generated-capture ReferenceError. Decided by the agent from VIP-1's hoisting guarantee, principle 2 (ordinary ECMAScript module dependency evaluation), and VIP-26's unchanged module model, 2026-10-30. The live cycle probes provide reference/prescribed/fixed receipts; no source restriction or compiler-conformance claim is added.

### Detail 163

**Moved ordinary-generator defaults execute during the construction call.** (live `001-generator-moved-default-phase`; VIP-1/VIP-2; details 68/108.) For ordinary function* and async function* declarations, expressions and methods, perform moved parameter/default work eagerly outside the dormant source body, once at construction. Do not put it at the beginning of a suspended body. Preserve the source parameter environments, length and bindings. Synchronous default throws remain construction throws under detail 108, including async generators; source effect/producer wrapping under 118 stays separate. Outward-return representation is the next item's pending choice.
    ```vibe
    let seen = 0
    function* g(x = do { seen += 1; return 7 }) { yield 1 }
    const result = g()
    const afterCall = seen // 1 before any resumption
    ```
    Effect TS: perform this eager work before constructing the source-body generator; the native phase oracle `function* g(x = (seen++, 7)) { yield 1 }` increments at the call. Decided by the agent from principle 2 (native generator parameter timing), VIP-1 and detail 108, 2026-10-30. Timing is settled independently of the early-return representation.

### Detail 164

**An outward return in an ordinary generator default uses a synthetic return iterator (class B, answered by Will).** (live `001-generator-moved-default-phase`; follows detail 163's timing.) Chosen A: after evaluating the prologue and return value v eagerly, return a native iterator over a synthetic return v, never starting the source body. First next is { done: true, value: v }; later next is done/undefined. Native return/throw-before-first-next behavior remains. Async generators use the corresponding async iterator. Include v in the iterator return type; the call keeps returning a generator. It is not literally an already-completed native generator, whose next would lose v.
    ```vibe
    function* g(x = do { return 7 }) { yield 1 }
    const r = g()
    // A (chosen by Will): r.next() is { done: true, value: 7 }; source body never starts
    // B: r itself is 7; the parameter ReturnCompletion escapes before iterator construction
    ```
    Effect TS: A's early path is `return (function* () { return v })()` (async function* for an async generator), with source generator identity/prototype/length guarantees preserved by the full lowering. B follows literal parameter ReturnCompletion before iterator construction and requires a generator-or-value call type. **Answered by Will, 2026-10-30 03:14 PDT: A** ("that's my answer then everything about the do expreession should work liike that spec"). Recommended by the agent on 2026-10-30 because it preserves the calling kind and mirrors already-boxed Effect/Promise/Stream defaults. Native TypeScript has no return-bearing parameter expression, and no existing VIP/detail reconciles this ordinary-generator representation with the draft's construction phase. This choice is separate from eager timing; do not ban the placement or silently defer its side effects.

### Detail 173

**A rethrows admission cannot erase the callback's contract on a value or nested callable.** (live `001-rethrows-returned-contract`; conservative clarification of details 3/4/38/66/120 under VIP-4/VIP-27.) Choose the existing `unknown` upper bound instead of adding callback-dependent return annotations. A `@rethrows` parameter admitting arbitrary throwing callbacks has an admitted thrown bound of `unknown` outside the annotated callable's own synchronous rethrow propagation. Returning or storing the callback, assigning it to another callable value, or capturing/invoking it in a nested callable must preserve that bound rather than recover the parameter type's unannotated `never`. Infer a nested plain callable that can invoke such a capture with `@throws {unknown}` (plus its own throws, whose union remains `unknown`); do the same for returned object callable members and preserve the contract in declaration output. Assignment to an unannotated nonthrowing destination is `EK0402`; an unwrapped possibly-throwing invocation in effect code is `EK0403`. This applies at a static callable boundary even if the nested function happens to be immediately invoked; no runtime escape analysis is required. Ordinary async/Effect callback boundaries retain their existing Promise/failure-channel rules and throw checks.
    **Current scope after Will's 2026-10-31 ruling:** local VibeLang thrown-type inference/annotations and any permission for synchronous source `throw` in this older record are superseded by `core-decisions.md`, `loop/WILL-ANSWERS.md` and detail 251. Do not implement those historical local clauses. Retain independently valid foreign-contract, native-phase and unrelated rules; reference receipts below are historical, not current VibeLang admission tests.
    **Immutable-main source receipt (695576, 173).** Verified at immutable main `695576acb44b`: 001/003 preserve admitted callback unknown throws across returned/stored/nested callables, with separate direct synchronous rethrows calculation. This is source-publication evidence only; no compiler/native/regression suite was run by decide-live.
    Status: applied in ababa10f87d9 (spec-fix-a; queued, not yet a main landing receipt).
    ```vibe
    /** @rethrows f */
    export function later(f: () => number) { return () => f() }
    const delayed = later(() => { throw "callback" }) // returned signature throws unknown
    const unsafe: () => number = delayed             // EK0402
    effect function bad() { return delayed() }        // EK0403
    effect function good() { return try Effect.try(() => delayed()) }
    ```
    Effect TS: the JavaScript `later` implementation is unchanged; `Effect.gen(function* () { return delayed() })` dies with `"callback"`, while `Effect.gen(function* () { return yield* Effect.try({ try: () => delayed(), catch: (e) => e }) })` fails in its typed channel. The emitted return is a callable type literal carrying `/** @throws {unknown} */ (): number`. Keep the existing own-throws-plus-actual-callback calculation for direct synchronous invocation/forwarding within the annotated callable; merely returning/storing a callback is not itself an invocation. No callback-dependent thrown variable, higher-rank declaration syntax, new runtime wrapper or blanket ban on returning closures is introduced. Decided by the agent from principle 8 (retain a sound upper bound instead of silently accepting a callback throw as `never`), principle 6 (no unwrapped tracked throw in effect code), principle 4 (reuse `unknown` and per-signature metadata), and VIP-27's existing declaration-preservation requirement, 2026-10-30. Evidence: `decide-live-scratch/rethrows-escape-reference.log`, verified Effect `4.1.0`; reference behavior only, not compiler conformance. Apply to 001's own-signature/rethrows/declaration rules and 003's assignability/body-inference rules.

Landing receipt: source ababa10f87d9 landed in main 695576acb44b (queue 1793371604-spec-fix-a, gate mq-10302026-7).

### Detail 178

**A super property used as a template tag retains its source receiver.** (live `001-super-tag-receiver`; VIP-1/VIP-31 binding preservation, extends the super-call row rather than adding syntax.) Treat a receiver-bearing super property reference used as a tag as a call reference, not as a detached value from `$super_get`. At the original tag-evaluation point, evaluate a computed key and look up the method once, before substitutions; retain the original source receiver for invocation. An implementation may return a fresh tag adapter that forwards the engine-created template object and substitutions through the captured intrinsic apply to that method/receiver pair. Never read or call the user function's own `call`/`bind` properties. Preserve source template-site caching, cooked/raw array identity and frozen state, substitution/evaluation order, callability-error order and the existing completion/error contract. Respect detail 110's cold lexical-this guarantee: do not read a derived constructor's `this` early merely to construct the enclosing cold Effect.
    Status: applied in main 0a207dbf, revalidated by spec-fix-a against the source binding rule, explicit import-cycle hoisting sentence and the five passing native binding tests. Earlier helper-recipe fixes are superseded; no duplicate patch.
    ```vibe
    class Base {
      n = 7
      tag(_parts: TemplateStringsArray, value: number) { return this.n + value }
    }
    class Derived extends Base {
      effect go() { return super.tag`value ${2}` } // succeeds with 9
    }
    ```
    Effect TS: wrap the same native super-tag expression in `Effect.sync(() => ...)` inside the same derived method; that lexical arrow preserves its source receiver. A generated adapter invokes the once-captured tag with the source instance via the captured apply; a detached `$super_get` value used directly as a tag loses `this` and defects. Ordinary optional super calls follow the same source Reference rule: obtain the method once, test it for nullishness before evaluating arguments, and preserve the receiver on the taken path; this does not introduce optional tagged-template syntax. Decided by the agent from VIP-1's existing promise that the body sees its source bindings, principle 2 (TypeScript/ECMAScript tagged-template Reference receiver and evaluation order), and principle 4 (the same receiver-preserving operation for all call uses of a super reference), 2026-10-30. Add the tag row/witness to 001 and exact-Exit checks; audit optional calls under the same requirement. Evidence: `decide-live-scratch/root-super-tag-reference.log` gives native `Success(9)`, detached-get `Die(TypeError)` and receiver-preserving adapter `Success(9)` on Effect `4.1.0`; `root-super-tag-types.log` passes strict TypeScript. These are reference/recipe checks, not VibeLang compiler conformance.
