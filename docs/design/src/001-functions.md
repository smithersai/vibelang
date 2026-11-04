# Functions and Effect types

Sources: [VIP-1](../vips/0001-effect-and-async-functions.md), [VIP-4](../vips/0004-throw.md) (legacy JavaScript), [VIP-3](../vips/0003-effect-type-shorthand.md), [VIP-26](../vips/0026-top-level-and-main.md), [VIP-27](../vips/0027-declaration-output.md), [VIP-40](../vips/0040-module-declarations.md).

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
const f: (x: number) => (number!!) = effect x: number!! => x // EK0109: parenthesize x
const g: (x: number) => (number!!) = effect <T> x => x       // EK0109: parenthesize parameters
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
| a recognized `effect` arrow head violating its required head form, a typed or generic bare parameter: `effect x: number!! => x`, `effect <T> x => x`; write the parentheses | `EK0109` |
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
| `var` | every `var` declaration, `for (var …)` included; a declaration rejected by a `do` early error uses the [specific diagnostics](002-running.md#do-expressions) | `let`, or `const` when the binding is never assigned |
| `with` | every `with` statement (already an early error in strict code, which a module is) | rewrite the property reads |

Property names on ordinary objects, such as `o.arguments`, `o.eval` and `{ var: 1 }`, are names, not references, and are unaffected. Three more rules close the other ways to reach these globals (VIP-33 and VIP-1, amended):

- **`globalThis`** may appear only as the object of a statically named member access: `.name`, `?.name`, `["name"]` or `` [`name`] `` with no substitutions. A member `eval` or `Function` is the global itself, so `globalThis.eval(s)` and `globalThis["Function"]("return 1")` are `EK0107`, with the two `Function` exemptions above: `x instanceof globalThis.Function` and `globalThis.Function.prototype` are allowed. A banned platform member is `EK4402` ([Services](005-services.md#the-platform-standard-library)). Every other use of `globalThis` is `EK0107`: a computed key that is not such a literal (`globalThis[k]`), an alias (`const g = globalThis`), destructuring (`const { eval: e } = globalThis`), an argument (`Reflect.get(globalThis, k)`), a spread, or the right operand of `in`. `typeof globalThis` in a type stays TypeScript's.
- **`.constructor` of a function.** Reading a property named `constructor` from a value whose static type is a function type or `Function` is `EK0107`: `(async () => {}).constructor` reaches the `AsyncFunction` constructor. `constructor` on other objects, and on values typed `any`, is unaffected.
- **Code in a specifier.** A string-literal `data:` or `blob:` specifier, in `import(…)` or an `import` declaration, is `EK0107`: it runs a string as code. `import(expr)` with a computed specifier is not checked; it loads a module and can't reach `eval` or `Function`.

With these five uses gone, no lowering has to hide its generator or generated names from evaluated code, and every declaration in a body is block-scoped or a parameter, so no lowering lifts a binding out of a block. [Region bodies](002-running.md#region-bodies), [Evaluation order](002-running.md#evaluation-order), [Pattern matching](004-match.md) and [Runtime guarantees](008-runtime.md) refer to this rule. Such code lives in a `.ts` file or a `module` body ([VIP-40](../vips/0040-module-declarations.md)).

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

A decorator expression on an `effect` method evaluates in its enclosing source context, as class heritage and computed keys do: `@(try d)` needs an enclosing Effect activation. An `effect` method keeps TypeScript's decorator checks and order, and applying a decorator does not run the cold body.

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

`infer` has no meaning in a return annotation: `--fix` deletes a bare `: infer _`, and an `Effect<A, infer E, R>` slot retires through the legacy path. Write the slot, or leave the whole annotation out.

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
- An effect function's annotation means the same as the annotation on its Effect TypeScript twin. A written `infer` slot, such as `Effect.Effect<A, infer E, R>` or `A!(infer E)!R`, has no special channel-inference meaning: ordinary TypeScript `infer` rules apply (`TS1338` outside a conditional type). The transitional exception is the diagnostic and preserving repair for the [legacy return-slot set](#legacy-written-infer-return-slots) below. To infer the return type in new code, omit the annotation.

### Legacy written `infer` return slots

While the VIP-3 migration exists, `EK4857` replaces `TS1338` for the same immediate written `infer` channel in this set:

- The annotation is the return annotation of a function declaration, function expression, arrow, or class or object method **with a body**, in a `.vibe` or `.vibex` file outside a TypeScript `module` body or a boundary hatch's TypeScript callback. It is neither `async` nor an ordinary generator.
- The annotation directly names the real Effect type and exposes its success, error and requirement channels: `Effect.Effect<A, E, R>`, the `A!E!R` shorthand, an equivalent imported or namespace-renamed Effect binding, or the supported retired prelude `Effect<A, E, R>` alias. A shadowing type named `Effect` or an arbitrary alias of a whole Effect type does not qualify merely by spelling or structure.
- At least one complete channel is written directly as `infer Name`, without enclosing parentheses or another type constructor. A parenthesized channel such as `number!(infer E)` was not a recognized legacy inferred slot and keeps native `TS1338`. An `infer` nested in a valid conditional type is native conditional inference, not a retired channel.

The set includes an **unmarked** function, expression, arrow or method whose explicit Effect return annotation selected the legacy Effect-function model; it is not restricted to today's `effect` modifier. VIP-1 still decides the meaning of repaired and new code: an unmarked callable is plain, and returning an Effect leaves it unrun. The migration does not add `effect`, `try` or execution merely because a return annotation qualified.

| Source position | Transitional diagnostic for the written channel |
| --- | --- |
| `function p(): Effect.Effect<number, infer E> { return Effect.succeed(1) }` | `EK4857` |
| `const a = (): number!(infer E) => Effect.succeed(1)` | Native `TS1338`: the channel is parenthesized |
| `class C { effect m(): Effect.Effect<number, infer E, never> { return 1 } }` | `EK4857` |
| `type F = () => Effect.Effect<number, infer E>` | Native `TS1338` |
| `function p(): number { return 1 }` | No written `infer` channel; no `EK4857` |

Function types, interface or bodyless call signatures, standalone type aliases, ordinary non-Effect annotations, constructors, accessors, `async` functions, ordinary generators and `.ts`/`.js` code are outside this migration. Existing producer migrations are separate. Invalid native `infer` outside the set keeps `TS1338`; valid conditional inference keeps TypeScript's meaning everywhere. Independent native errors remain, including on an eligible return annotation. After this migration retires, `TS1338` alone remains wherever TypeScript rejects the occurrence.

`--fix` writes checker-proved inferred channel types, preserving declaration types and runtime behavior, or refuses with an explanation if it cannot name those types safely. It may remove the whole return annotation only on an explicitly `effect`-marked callable when every channel is `infer` and preservation is proved. It does not offer that removal merely because an unmarked callable's annotation belongs to the set. These are VIP-34's preserving-fix checks, not permission for partial inference in new source.

```vibe
// compiler-gap: pending VIP-3
effect function f(): Effect.Effect<number, infer E, never> { return 1 } // EK4857, not TS1338
effect function g(): number!(infer E) { return 1 } // TS1338: parenthesized channel, outside the legacy set
```

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
- There is no magic entry point. A function named `main` is an ordinary function, and you run it with a runner yourself, exactly as in Effect TypeScript. An exported `const main` or `let main` is an ordinary lexical binding: a read before initialization throws JavaScript’s `ReferenceError`.

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

### `module` declarations

A `.vibe` or `.vibex` file may hold TypeScript inline ([VIP-40](../vips/0040-module-declarations.md)). `module name { … }` is a [ModuleDeclaration](900-appendices.md#moduledeclaration) at the file's top level. Its body is a TypeScript file stored in the `.vibe` file: moving it to a sibling `.ts` file (`.tsx` for a body in `.vibex`) with its external-module classification preserved and replacing `from name` with that file's specifier changes no diagnostic, type, emitted statement, declaration or run-time observation. So a body is `.ts`, or `.tsx` in a `.vibex` file, under the project's `compilerOptions`; it may `throw`, use `node:*` and legacy JavaScript; and it sees none of the file's names. It evaluates once, in import order, only when imported for a value. No VibeLang rule runs on it, except the three below.

A body is an external module before binding and checking, even without written imports or exports and regardless of `moduleDetection`. Its virtual source, JavaScript and declarations preserve that classification. The TypeScript twin and the move refactor use `.ts` for a body in `.vibe` and `.tsx` for one in `.vibex`, preserving its source language variant even when the body has no JSX. In that file, add `export {}` if the unchanged body would otherwise be a script under the project's options. This preserves private names and module-only checks; a side-effect import in the containing file does not classify the copied file as a module ([VIP-40](../vips/0040-module-declarations.md#syntax)).

Body outputs use the source file's full basename, including `.vibe` or `.vibex`, followed by `.` and the encoded module name. Encoding keeps `a`–`z`, `0`–`9` and `_`; every other Unicode code point becomes `-`, its code point in lowercase hexadecimal without leading zeros, and `-`, without case folding or Unicode normalization. The identifier's decoded name is encoded, so escapes and literal characters agree. Thus `module Über` in `main.vibex` has stem `main.vibex.-dc-ber`. JavaScript, declarations, maps and loader requests share that stem; [VIP-40](../vips/0040-module-declarations.md#emit-declarations-source-maps) specifies the output suffixes.

```vibe es
// compiler-gap: pending VIP-40
module parse {
  /** @throws {RangeError} */
  export function port(raw: string): number {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new RangeError(`bad port: ${raw}`)
    return n
  }
}

import { port } from parse

export effect function loadPort(raw: string) {
  return try Effect.try(() => port(raw))
}
```

```ts effect
// fragment
// parse.ts
/** @throws {RangeError} */
export function port(raw: string): number { /* as above */ }

// config.ts
import { Effect } from "effect"
import { port } from "./parse.ts"
export function loadPort(raw: string) { return Effect.gen(function* () { return yield* Effect.try(() => port(raw)) }) }
```

| Rule | Diagnostic | Quick fix |
| --- | --- | --- |
| a module declaration below the file's top level | `EK4001` | move it to the top level |
| `export module name { }` or `export default module { }` | `EK4002` | `export { … } from name` |
| a module expression `module { … }` | `EK4003` | name it, and import from it |
| the name used as a value: `import(name)`, `name.x`, `typeof name`, an argument | `EK4004` | a static import from `name` |
| the name redeclares a binding of the file | `EK4005` | rename one |
| an identifier specifier naming no declaration of the file, or carrying import attributes | `EK4006` | fix the name, or quote a package name |
| an identifier specifier inside a body | `EK4007` | move the shared code to a `.ts` file |
| `export =` or `import x = require()` in a body | `EK4008` | `export default`, `import` |
| `import.meta` in a body | `EK4009` | pass the value in, or use a `.ts` file |

Other `module A.B { }` and `declare module C { }` forms keep TypeScript's `TS1540`.

## Declaration output

For each `x.vibe`, the compiler writes `x.d.vibe.ts` beside it, and for each `x.vibex`, `x.d.vibex.ts` (VIP-27, VIP-39). TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc` and TypeDoc understand imports of `.vibe` files. With `vibe.sidecarDir` the sidecars sit at their sources' paths under that directory instead, and tsconfig `rootDirs` lets the same tools resolve them ([Configuration](007-tooling.md#config-files); VIP-27, amended). A package build also writes ordinary `.d.ts` files to its output directory.

`bun check` runs the project's `check` script; a script that invokes a TypeScript checker uses that checker's sidecar resolution.

<a id="api-identity"></a>**API identity.** Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin: the same exported names, each export's type identical to `tsc`'s in both directions (a type-level check), and the same doc comment on each export. Formatting, quote style, import extension spelling, and import and member order where `tsc` doesn't care don't count. Every rule that requires declarations to match, the codemods and migration included, means this.

Construct the twin with the explicit `@throws {never}` contract on each non-effectful signature for which VibeLang emits it. Preserve the source documentation and add that tag to the twin's JSDoc before running `tsc`; do not add it to the `.vibe` source, where it is `EK0406`. This makes the same-comment comparison include the required cross-module contract: an unannotated TypeScript twin would instead advertise `unknown` and would not represent the same API. Effectful signatures and re-exported foreign callables retain their own declaration rules.

- **Content.** Declarations are exactly what idiomatic Effect TypeScript would declare. Ordinary interface and object-type properties, including optional members and index signatures, keep exactly the source's written `readonly` modifiers, including in nested object types; class fields keep their written modifiers too. Each keeps its source form: a function declaration is a `declare function`, and a `const` holding an arrow is a `declare const`. A `service`, `error`, `schema`, `schema error` or `data` declaration is declared as TypeScript's declaration emit of its Effect TypeScript counterpart, which introduces a `Name_base` constant for a class-call heritage such as `Context.Service<…>()("k")`. The output imports every name the source had in scope without an import: each root module as `import { Effect, Stream } from "effect"`, each subpath namespace from its subpath, and a module whose bare name is a JavaScript global's (`Array`, `Console`) under a fresh alias, as emitted code does ([Services](005-services.md#effects-modules-are-in-scope)). A declaration writes such a name only where the source writes it: an inferred signature that a library declares with a name the file never writes keeps TypeScript's import type, so `Schema.decodeUnknownSync(Schema.String)` declares `options?: import("effect/SchemaAST").ParseOptions`. A form that stands for a module writes its name: an Effect function, `A!E!R`, `try` or a bare Effect global such as `sleep` writes `Effect`, which its Effect TypeScript imports. Nothing in it depends on `vibe.effectModules` or `vibe.effectGlobals`. The generic-`data` helper for `data Outcome<A>` is named `$Outcome$Definition`; if the module already declares that name, the compiler appends `$2`, `$3`, … and takes the first free name, so the name is the same on every build (VIP-28, amended). An `error` or `schema error` keeps its static `[Symbol.customMatcher]` member, and every declaration file whose emitted text names `Symbol.customMatcher` begins with `/// <reference types="vibelang-runtime" />`, which declares the `Symbol.customMatcher` type, so plain `tsc` checks it and matching across packages works at run time (VIP-27, amended).
- **Specifiers.** Declaration emit follows TypeScript for the source’s `.ts`/`.tsx` twin. The twin uses the same tsconfig, without enabling extension flags ([source-extension checks](007-tooling.md#config-files)). Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling. Synthesized import types use TypeScript’s spelling for the twin under the same imports and tsconfig. Compatibility sidecars instead keep VibeLang source references such as `./user.vibe` and `./App.vibex`, relocated to the selected compatibility declaration when necessary, to preserve source identity. Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate. No declaration spelling setting exists (VIP-27, VIP-30, amended).
- **Import presentation.** An import introduced by declaration output uses the quotes of the file’s first written import or export specifier, or double quotes if none exists, as TypeScript’s import insertion does. Names already written through one source import keep that import’s order and quotes; a needed generated name joins the same compatible import. For example, `import { HashSet, Option } from 'effect'` may become `import { Effect, HashSet, Option } from 'effect'`. Preserve the source module identity and native declaration naming rules above.

- **Cyclic inferred types.** Declaration serialization retains TypeScript 5.9 and 7.0 behavior where TypeScript 7.1's [new anonymous-type cycle check](https://github.com/microsoft/TypeScript/pull/64461) would report `TS5088`: the repeated anonymous type is written as `/*elided*/ any`, without an error for that cycle. This applies to `.vibe` and `.ts` alike (VIP-27, amended). Other `TS5088` checks and ordinary recursive-inference errors `TS7022`, `TS7023` and `TS7024` remain unchanged.

- **Producer environments.** An inferred producer declaration exposes the environment `Exclude<RBody, Scope.Scope>` for its body requirements `RBody`, because the accepted `Stream.callback` provides `Scope`. Preserve other services, ordinary checks on explicit annotations and values of type `Scope.Scope` ([Producers](002-running.md#producers)).
- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias carry `@throws {never}`. A foreign reader treats a declaration without a tag as throwing `unknown`, so this constant is the boundary, not an inferred contract. An effectful function carries no `@throws`. A bare function type stays a function type, and getters and setters carry none. A re-exported foreign callable keeps its actual `@throws` and `@rethrows`.

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
// compiler-gap: pending VIP-27
// load.vibe
export effect function load(id: string) { return try fetchUser(id) }
export function users(ids: string[]) { return Stream.fromIterable(ids) }
export const add = (a: number, b: number) => a + b
export async function get(q: string) { return await queryDb(q) }
export class Id {
  constructor(readonly s: string) { }
  get size() { return this.s.length }
}
export interface Store { find(id: string): string }
```

```ts effect
// fragment
// load.d.vibe.ts
import { Effect, Stream } from "effect"
export declare function load(id: string): Effect.Effect<User, NotFound, Users>   // effectful: no @throws
export declare function users(ids: string[]): Stream.Stream<string>              // effectful: no @throws
/** @throws {never} */
export declare const add: (a: number, b: number) => number
/** @throws {never} */
export declare function get(q: string): Promise<Row[]>
export declare class Id {
  readonly s: string
  /** @throws {never} */
  constructor(s: string)
  get size(): number
}
export interface Store {
  /** @throws {never} */
  find(id: string): string
}
```
