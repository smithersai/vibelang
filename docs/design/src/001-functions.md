# Functions and Effect types

Sources: [VIP-1](../vips/0001-effect-and-async-functions.md), [VIP-3](../vips/0003-effect-type-shorthand.md), [VIP-26](../vips/0026-top-level-and-main.md), [VIP-27](../vips/0027-declaration-output.md).

A function's kind is decided by a keyword on the function, never by its body or by a type. There are three kinds:

| Kind | Written | Calling it gives | Inside it |
| --- | --- | --- | --- |
| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |
| `async` | `async function f() { }`, `async () => …`, `async m() { }` (a method) | a Promise, as in TypeScript | `await` waits for a Promise |
| `effect` | `effect function f() { }`, `effect () => …`, `effect m() { }` (a method) | an Effect, not yet run | `try` runs an Effect |

## `effect` functions

### Syntax

```text
EffectFunction    = "effect" "function" Name? TypeParameters? Params ReturnType? Block
EffectArrow       = "effect" TypeParameters? ArrowParams ReturnType? "=>" ConciseBody
EffectMethod      = Modifiers? "effect" PropertyName TypeParameters? Params ReturnType? Block   (in a class or object literal)
```

`ArrowParams` and `Modifiers` are TypeScript's, as for `async`: `effect x => …` is allowed, and `Modifiers` covers `static`, `public`, `private`, `protected` and `override`.

- `effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1). `Name` is optional where it is optional for `async function`: required in a declaration except `export default effect function () { }`, optional in an expression.
- There is no top-level shorthand: `effect load() { }` and `async load() { }` outside a class or object literal are syntax errors, with a quick fix that inserts `function`. Diagnostic: code pending.
- As for `async`: `static effect m()` is allowed; getters, setters and constructors can't be `effect`; and `effect() { }` alone is a method named `effect`.
- `effect` and the function, name or parameters it modifies are on one line, as with `async`.
- Anywhere else, `effect` is an ordinary identifier, so `Layer.effect(…)` and `const effect = …` keep working.
- `effect function*` declares a producer ([Running Effects](002-running.md#producers)).

**Undecided (pending VIP):** whether `effect` and `async` may both modify one function, and what that would mean.

### Static rules

| Rule | Diagnostic |
| --- | --- |
| `await`, `for await` or `await using` inside an `effect` function | code pending |
| `await` applied to an Effect inside an `async` function | code pending |

"Inside" means the innermost enclosing function, as for `await` in JavaScript: a plain arrow written inside an `effect` function is a plain function, and `try` is an error inside it. That is the one rule "`try` outside effect code" of [Running Effects](002-running.md#static-rules).

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

Each form keeps the form it is written in, as `async` does. A declaration stays a hoisted function declaration, so a call above it works:

| VibeLang | Effect TypeScript |
| --- | --- |
| `effect function f(p) { B }` | `function f(p) { return Effect.gen(function* () { B }) }` |
| `effect function (p) { B }` | `function (p) { return Effect.gen(function* () { B }) }` |
| `effect (p) => B` | `(p) => Effect.gen(function* () { B })`; `Effect.gen({ self: this }, function* () { B })` when `B` reads `this` |
| `effect m(p) { B }` | `m(p) { return Effect.gen(function* () { B }) }` |
| `export default effect function (p) { B }` | `export default function (p) { return Effect.gen(function* () { B }) }` |

Parameters, defaults included, are bound when the function is called. The body runs each time the Effect runs. VIP-2 fixes this meaning: `effect { … }` is `Effect.gen(function* () { … })`, and the same as `(effect () => { … })()`.

**Bindings.** The body sees the bindings of the function it is written in, as an `async` body does. The generator `Effect.gen` takes would have its own, so the compiler passes them in, with fresh names:

| In the body | Effect TypeScript |
| --- | --- |
| `this` | `Effect.gen({ self: this }, function* () { … })`; the generator's `this` is `self` |
| `arguments`, `new.target` | a temporary, `const $arguments = arguments` |
| `super[k]`, `super.m` | `$super_get(k)`, with `const $super_get = (k) => super[k]` |
| `super[k] = v` | `$super_set(k, v)`, with `const $super_set = (k, v) => (super[k] = v)`; `super.x += v` reads with `$super_get` and writes with `$super_set`, evaluating `k` once |
| `super.m(a)` | `$apply($super_get("m"), this, [a])`, where `$apply` is `Reflect.apply` captured when the module starts. The method is looked up before `a` is evaluated, and its own `call` property is never read |

The temporaries and helpers are declared at the top of the innermost enclosing non-arrow function, or the module, once per call, as TypeScript's own `async` downleveling does with `_arguments` and `_superIndex`. In an `effect` arrow and an `effect` block these bindings are that enclosing function's, as in any arrow. A function nested in the body has its own, as in TypeScript.

```vibe es
// compiler-gap: pending VIP-1
class Counter extends Base {
  n = 7
  effect value() { return this.n + super.offset() }
}
effect function count(x: number) { return arguments.length }
```

```ts effect
// fragment
const $apply = Reflect.apply
class Counter extends Base {
  n = 7
  value() {
    const $super_get = (k: PropertyKey) => super[k as keyof Base]
    return Effect.gen({ self: this }, function* () { return this.n + $apply($super_get("offset"), this, []) })
  }
}
function count(x: number) {
  const $arguments = arguments
  return Effect.gen(function* () { return $arguments.length })
}
```

With `Base.prototype.offset` returning 30, `value()` succeeds with 37 even if `offset` has an own `call` property; `count(1, 2, 3)` succeeds with 3.

### Return types

An `effect` function's return type is an Effect, as an `async` function's is a Promise. It can be written, or left out and inferred:

```vibe es
// compiler-gap: pending VIP-1
effect function load(id: string): Effect.Effect<User, NotFound, Users> { return try fetchUser(id) }   // written
effect function load2(id: string) { return try fetchUser(id) }                                 // inferred: the same type
async function get(q: string): Promise<Row[]> { return await queryDb(q) }                      // as in TypeScript
```

An inferred type takes its success from what the function returns, and its errors and requirements from the Effects its body runs, exactly as `Effect.gen` infers them.

### Crossing between Promises and Effects

No construct converts between the two. Effect's own functions do, as [VIP-6](../vips/0006-effect-globals.md) globals:

| From | To | Write |
| --- | --- | --- |
| a Promise, in an `effect` function | an Effect | `try tryPromise(() => queryDb(q))` or `try promise(() => p)` |
| an Effect, in an `async` function | a Promise | `await runPromise(load(id))` |

In these examples `queryDb` is a Promise-returning function imported from a `.ts` module. A platform call such as `fetch` can't appear in a `.vibe` file at all, wrapped or not ([Services](005-services.md#the-platform-standard-library)).

## The `A!E!R` type shorthand

### Syntax

```text
EffectType    = EffectOperand "!" EffectOperand "!" EffectOperand   (A!E!R)
              | EffectOperand "!" EffectOperand                     (A!E)
              | EffectOperand "!" "!" EffectOperand                 (A!!R)
              | EffectOperand "!" "!"                               (A!!)
EffectOperand = a Type that is not itself an EffectType unless parenthesized
```

`A!B!C` is always the three-slot form, never `(A!B)!C`; write the parentheses to nest. `A!!B!C` is a syntax error.

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

**Undecided (pending VIP):** how `!` binds next to other type operators, for example whether `A | B!E` is `(A | B)!E` or `A | (B!E)`, and whether a union in the error slot needs parentheses.

## Modules and the top level

A module's top level is ordinary JavaScript (VIP-26).

- `await` at the top level is ES top-level await of a Promise.
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
```

## Declaration output

For each `x.vibe`, the compiler writes `x.d.vibe.ts` beside it (VIP-27). TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc`, TypeDoc and `bun check` understand imports of `.vibe` files. A package build also writes ordinary `.d.ts` files to its output directory.

- **Content.** Declarations are exactly what idiomatic Effect TypeScript would declare. Each keeps its source form: a function declaration is a `declare function`, and a `const` holding an arrow is a `declare const`.
- **Effectful functions carry no `@throws`.** A function that returns an `Effect`, a `Stream` or a `Layer` can't throw, so it carries none (VIP-4).
- **Every other exported callable carries `@throws`:** a function, a method, a constructor (`new X()` is throw-tracked) and a function-typed `const`. The tag is its inferred thrown type, or `@throws {never}` when it can't throw. Getters and setters carry none: they are not throw-tracked.
- **`async`.** An `async` function carries `@throws {never}`: calling it returns a Promise, as in TypeScript, and a throw in its body rejects that Promise ([Failures](003-failures.md#calls-that-may-throw)).
- **Function types.** A function type or interface member with no `@throws` is non-throwing, as Swift's non-`throws` function type is. A function that calls a parameter it was given, and throws what that parameter throws, says so with `@rethrows <param>`.

**Undecided (pending VIP):** a plain, non-`async` `.vibe` function whose return type is an Effect and whose body may `throw` before returning it. It returns an Effect, so it carries no `@throws`, yet calling it can throw.

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
export function each(xs: string[], f: (s: string) => void) { xs.forEach(f) }
```

```ts effect
// fragment
// load.d.vibe.ts
export declare function load(id: string): Effect.Effect<User, NotFound, Users>   // effectful: no @throws
export declare function users(ids: string[]): Stream.Stream<string>              // effectful: no @throws
/** @throws {BadInput} */
export declare function parse(s: string): string
/** @throws {never} */
export declare const add: (a: number, b: number) => number
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
```
