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

- `effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1), apart from the `effect { … }` block (VIP-2). `Name` is optional where it is optional for `async function`: required in a declaration except `export default effect function () { }`, optional in an expression.
- There is no top-level shorthand: `effect load() { }` and `async load() { }` outside a class or object literal are syntax errors, with a quick fix that inserts `function`. At a statement start or after `export`, `effect` or `async` followed by a name other than `as` or `satisfies`, then `(` or `<`, parses so this rule can report it. `effect as (Handler)` stays TypeScript's type assertion. `EK0101`.
- As for `async`: type parameters follow the name, as in `effect m<T>(x: T) { }` and `effect function f<T>(x: T) { }`; `static effect m()` and a private `effect #load() { }` are allowed; getters, setters and constructors can't be `effect`; and `effect() { }` alone is a method named `effect`.
- `effect get x() { }` and `effect set x(v) { }` parse, so the getter/setter rule below reports them, as TypeScript parses `async get x() { }` and reports TS1042.
- `effect` and the function, name or parameters it modifies are on one line, and an arrow's `=>` is on the line its parameters end, as with `async`.
- Anywhere else, `effect` is an ordinary identifier, so `Layer.effect(…)` and `const effect = …` keep working. As with `async`, an arrow needs its whole head: `effect(x) => …` is an arrow, and `effect(x)` without `=>` is a call.
- A decorator list precedes the class modifiers, as for `async` methods; object-literal methods have no decorators. An `effect` function declaration or class method may have bodyless overload signatures wherever TypeScript admits the corresponding `async` signatures, with its ordering, adjacent-implementation, compatibility and semicolon rules. Function expressions, object-literal methods and arrows require bodies. Starred overload signatures, `abstract effect` methods and ambient `effect` declarations are rejected as their `async` counterparts are.
- `effect function*` declares a producer ([Running Effects](002-running.md#producers)).

`effect` and `async` on one function, in either order, is a compile error, with quick fixes that remove one modifier (decided detail 46). Both orders parse as an [EffectModifier](900-appendices.md#effectmodifier), so the error is `EK0105`, not a generic syntax error. No Effect TypeScript function is both an `Effect.gen` and a Promise-returning `async` function.

```vibe es
// compiler-gap: pending VIP-1
effect async function f() { }   // EK0105: pick effect or async
async effect function g() { }   // EK0105
const h = async effect () => 1  // EK0105
class K { async effect get x() { return 1 } }   // EK0104 and EK0105
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

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block | `EK0102` |
| `await` on an Effect, by the [Result test](002-running.md#result-tests) (decided detail 89: not `never`, `any` or `unknown`, and at least one union member an Effect), in an `async` function or at the module top level (VIP-5); write `await runPromise(e)` | `EK0103` |
| `effect` on a getter, setter or constructor | `EK0104` |
| `effect` and `async` on one function | `EK0105` |
| A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`, an alias included, as TS1064 requires `Promise<T>` for `async` (`any`, `unknown` and `never` are errors) | `EK0106` |
| A banned use of `eval`, `Function`, `arguments`, `var` or `with` anywhere in a `.vibe` file, plain functions included, as [Legacy JavaScript](#direct-eval) defines it | `EK0107` |

```vibe es
// compiler-gap: pending VIP-1
async function a() { await main() }                 // EK0103: write await runPromise(main())
async function b(x: any) { return await x }         // ok: any is not an Effect for EK0103
effect function n(): number { return 1 }            // EK0106: write number!! or leave it out
```

`new f()` on a `.vibe` function gets TypeScript's own error only, with no VibeLang check (VIP-1, amended; decided detail 19).

"Inside" means the innermost enclosing function, as for `await` in JavaScript: a plain arrow written inside an `effect` function is a plain function, and `try` is an error inside it.

`try` works like `await`, so an `effect` function's parameter list, a class field initializer and a `static` block are not effect code, as `await` can't appear there in an `async` function ([the grammar's Effect parameter](900-appendices.md#the-effect-parameter)). An effect construct there is that construct's "outside effect code" error ([Running Effects](002-running.md#static-rules)). What a parameter default may throw is in [Code outside the generator](003-failures.md#code-outside-the-generator).

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

Parameters, defaults included, are bound when the function is called, before `Effect.gen`, as an `async` function's are bound before its body starts. [Parameter defaults](002-running.md#parameter-defaults) says what a default may do: `effect function g(x = do { return null }) { return 1 }` is a function whose call `g()` gives an Effect that succeeds with `null`. The body runs each time the Effect runs. VIP-2 fixes this meaning: `effect { … }` is `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.

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

<a id="direct-eval"></a>**Legacy JavaScript.** Five JavaScript features are compile errors anywhere in a `.vibe` file, plain functions included, each with a quick fix (VIP-1 and VIP-4, amended 2026-10-29). Code that needs one lives in a `.ts` or `.js` file.

| Banned | What the rule matches | Quick fix |
| --- | --- | --- |
| `eval` | every `IdentifierReference` named `eval`: a direct `eval(s)` as ECMAScript defines it, and indirect uses such as `(0, eval)(s)`, `eval?.(s)` and `const e = eval` | move the code to a `.ts` or `.js` file |
| `Function` | every `IdentifierReference` resolving to the global `Function` constructor, except the right operand of `instanceof` (decided detail 33) and the object of a statically named `prototype` access, `Function.prototype`, `Function?.prototype` or `Function["prototype"]` (decided detail 97): `new Function("a", "return a")`, `Function("return 1")`, `Function?.(s)`, `const F = Function`, `Function.call(null, "return 7")`, `Function.name`. `x instanceof Function` and `Function.prototype.toString.call(f)` are allowed; the type `Function`, as in `const f: Function = g`, stays TypeScript's | move the code to a `.ts` or `.js` file |
| `arguments` | every `IdentifierReference` named `arguments` | a rest parameter |
| `var` | every `var` declaration, `for (var …)` included | `let`, or `const` when the binding is never assigned |
| `with` | every `with` statement (already an early error in strict code, which a module is) | rewrite the property reads |

Property names on ordinary objects, such as `o.arguments`, `o.eval` and `{ var: 1 }`, are names, not references, and are unaffected. Three more rules close the other ways to reach these globals (decided details 73, 74 and 75):

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
effect function load(id: string): Effect.Effect<User, NotFound, Users> { return try fetchUser(id) }   // written
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

### Crossing between Promises and Effects

No construct converts between the two. Effect's own functions do, as [VIP-6](../vips/0006-effect-globals.md) globals:

| From | To | Write |
| --- | --- | --- |
| a Promise, in an `effect` function | an Effect | `try tryPromise(() => queryDb(q))` or `try promise(() => p)` |
| an Effect, in an `async` function | a Promise | `await runPromise(load(id))` |

In these examples `queryDb` is a Promise-returning function imported from a `.ts` module with no `@throws`, so it may throw `unknown` ([Thrown types](003-failures.md#thrown-types)); `tryPromise` makes a throw or a rejection a failure. `promise(() => p)` wraps a Promise `p` already in hand that can't reject: a rejection there is a defect, so use `tryPromise` otherwise. A platform call such as `fetch` can't appear in a `.vibe` file at all, wrapped or not ([Services](005-services.md#the-platform-standard-library)).

## The `A!E!R` type shorthand

### Syntax

[EffectType](900-appendices.md#effecttype). `A!B!C` is always the three-slot form, never `(A!B)!C`; write the parentheses to nest. A line break ends an Effect type, as it ends TypeScript's postfix type operators: each `!`, and the slot after it, start on the line where the previous slot ends, and a slot in parentheses may span lines. The `R` after `!!` never starts with `{`, so `): number!! {` begins the body; write `A!!({ … })` for a type-literal requirement. The scanner splits `!=` or `!==` into `!` and `=` or `==` only directly after `A!`, where the `!` completes `A!!`, as TypeScript rescans `>=` only after type arguments. Anywhere else they stay equality operators, as in TypeScript:

```vibe es
// compiler-gap: pending VIP-3
const e: User!!= load()     // const e: User!! = load()
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

`!` does not mix with `|`, `&`, conditional types, or a function or constructor type in a slot, without parentheses: each is a syntax error with a quick fix that parenthesizes (decided details 47 and 80; `EK0301`). A slot holds such a type only in parentheses, as in `User!(NotFound | Timeout)`. Each slot is a type-operator-level type, as an operand of `&` is in TypeScript (`keyof A & B` is `(keyof A) & B`): `keyof`, `readonly`, `[]` and `[K]` bind tighter than `!`.

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

The same rule covers a conditional type's parts, so an Effect type there is parenthesized. A function or constructor type's return is a whole type, as `() => A | B` is `() => (A | B)` in TypeScript, so `=> A!E` needs no parentheses (decided detail 80); `=> A!E | B` still mixes `!` and `|`:

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

A module's top level is ordinary JavaScript (VIP-26). Every `.vibe` file is a module, as a `.mts` file is, whether or not it has an `import` or `export`: its code is strict, top-level `await` is allowed, top-level `this` is `undefined`, and its declarations are module-scoped. `moduleDetection` does not change this.

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

For each `x.vibe`, the compiler writes `x.d.vibe.ts` beside it (VIP-27). TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc`, TypeDoc and `bun check` understand imports of `.vibe` files. A package build also writes ordinary `.d.ts` files to its output directory.

- **Content.** Declarations are exactly what idiomatic Effect TypeScript would declare. Each keeps its source form: a function declaration is a `declare function`, and a `const` holding an arrow is a `declare const`. A `service`, `error`, `schema`, `schema error` or `data` declaration is declared as TypeScript's declaration emit of its Effect TypeScript counterpart, which introduces a `Name_base` constant for a class-call heritage such as `Context.Service<…>()("k")`. The output imports every name the source had in scope without an import: each root module as `import type { Effect, Stream } from "effect"`, each subpath namespace from its subpath, and a module whose bare name is a JavaScript global's (`Array`, `Console`) under a fresh alias, as emitted code does ([Services](005-services.md#effects-modules-are-in-scope)). Nothing in it depends on `vibe.effectModules` or `vibe.effectGlobals`. The generic-`data` helper for `data Outcome<A>` is named `$Outcome$Definition`; if the module already declares that name, the compiler appends `$2`, `$3`, … and takes the first free name, so the name is the same on every build (decided detail 83). An `error` or `schema error` keeps its static `[Symbol.customMatcher]` member, and a declaration file that declares one begins with `/// <reference types="vibelang-runtime" />`, which declares the `Symbol.customMatcher` type, so plain `tsc` checks it and matching across packages works at run time (decided detail 67c).
- **Thrown types.** Each declaration carries its thrown type as [Thrown types](003-failures.md#thrown-types) defines it. An effectful function carries no `@throws`. Every other call signature the output emits carries `@throws {T}`, `@throws {never}` included, so no reader depends on a default: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias (decided detail 66). A bare function type (`() => string`) stays a function type. Getters and setters carry none.
- **Each call signature carries its own contract** ([Thrown types](003-failures.md#thrown-types), decided detail 38): every overload, and a returned callable's own signature. TypeScript attaches JSDoc to a call signature but not to a function type, so a callable `const` is declared with a type literal whose call signature carries the tag. A written `@throws {T}` is a checked upper bound, so the output copies `T`; otherwise it writes the inferred type. A tag on an alias of a function type does not attach to its call signature; write `type Reader = { /** @throws {E} */ (): string }` instead (decided detail 38). A foreign callable binding without a tag on itself or its declared call signature throws `unknown`, whether imported from source or an emitted `.d.ts`, even with a written function type (decided details 37 and 66).
- **`@rethrows` is copied and adds to own throws.** A source `/** @rethrows <param> */` tag (VIP-4) is written, never inferred, and the output copies it. For a non-effectful callable, first determine its own thrown type: a written checked bound, else a shipped signature annotation, else local body inference or the foreign/type-position default. Shipped annotations are installed before defaults apply. At each call, union that type with the thrown types of the arguments for every `@rethrows` parameter (decided detail 66). Thus `@throws {never}` describes only own throws; it does not erase `@rethrows f`. Effectful callables have synchronous thrown type `never`, and `@rethrows` adds nothing.
- A plain `.vibe` function that returns an Effect, a Stream or a Layer is effectful, so it can't throw (VIP-4, amended: an effectful function cannot throw; the later "`try` only in effect code" amendment lets plain non-effectful functions throw) ([Effectful callables](003-failures.md#effectful-callables)):

```vibe es
// compiler-gap: pending VIP-4
export function bad(id: string) { if (!id) throw new BadInput(); return fetchUser(id) }   // error: can't throw
export function load(id: string): Effect.Effect<User, NotFound | BadInput> { return id ? fetchUser(id) : fail(new BadInput()) }
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
import type { Effect, Stream } from "effect"
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
