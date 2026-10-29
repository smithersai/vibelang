## Part II. The rules

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

Part I showed the language by example. This part states its rules precisely, still from the programmer's side; Part III explains how the runtime carries them out.

### 13. What a call means

#### The principle

Calls work exactly as a TypeScript developer reading the code expects. Read every call of an effectful function as if it had an implicit `await`:

- A call does its work where it stands.
- Its callee and arguments are evaluated once, left to right, before the call, as in JavaScript, except an operand that syntax defers (rule D): `fork`'s, an await operation's literal elements, a hatch's first argument, and the right side of `x catch y`, which is evaluated only after `x` fails.
- Its value is what the callee returns. For an effectful callee, that is the success value; a failure propagates as a thrown error does. A call whose callee's declared return type is definitely an Effect runs where it stands, whatever its callee compiles to (D480).
- Delaying work means writing a function, `() => f(x)`, as in TypeScript.
- Whether a call runs is read from the declared return type of the signature the call resolves to, as a TypeScript reader reads `Promise` off a signature. Overload resolution picks that signature as TypeScript does, from the arguments' types, except that an Effect never stands for a plain function type, which TypeScript allows (rule F, D430). Nothing the call itself instantiates, no annotation on the binding that receives the call's value, no type of a parameter the call fills, and no name spelling changes when, whether, or how often the call runs or its operands are evaluated. A function written as an argument is a value, and its body runs when its receiver calls it. Its form, plain or Effect, is written, by its return annotation or by the declared type at its destination, and never read from its body (rule F, D500); the overload TypeScript picks and, through inference, the call's own contextual type give that destination, so they decide whether such a function compiles and, for one whose body compiles in either form, which form it takes, and with it whether the receiver's call of it runs its body or builds a program; that is rule F's rough edge, which a written form removes (D482, D494, D510). A type may reject a program; in the places [Where a type decides](#where-a-type-decides) lists, and only there, it also decides what a program does, and each entry says what it decides and what it never decides.

This is the test for every rule in Part II: if a TypeScript developer reading a call would be surprised by when or how often something runs, the rule is wrong (D320). Kotlin's suspending functions work the same way: a call to one suspends where it stands, after its arguments are evaluated, and only a lambda delays work.

```ts es
const user = fetchUser(id)                        // runs here: user is a User
const name = user.name.trim()
const fresh = retry(() => fetchUser(id), policy)  // the arrow delays: retry runs it per attempt
const later = () => fetchUser(id)                 // nothing runs
const again = later()                             // runs now
```

#### Two verbs

This part uses two verbs. To **evaluate** an expression is to compute its value, as JavaScript does; evaluating a call that runs includes running it. To **run** a program is to execute it on the current fiber until it succeeds or fails. A **program** is a value that describes work without doing it: a function with no required parameters, or an `Effect` value (D381). Building a program does none of its work; each run of it does all of it again, with fresh local bindings.

#### Three kinds of call

Every call expression, `f(args)`, `o.m(args)`, `f?.(args)`, `o?.m(args)`, or a tagged template `` f`…` ``, is exactly one of three kinds, except the parenthesized keyword forms of rule H5, `fork(x)`, `join(x)`, and the await operations, which are syntax, and a hatch, whose first argument is TypeScript. Its syntax and the signature its callee resolves to decide which; nothing else does.

| Kind | Trigger | Meaning |
| --- | --- | --- |
| Run | The declared return type of the signature the call resolves to is definitely an Effect, or the callee is a program value | Evaluate the callee and the arguments, run the returned program on this fiber, and take its success value |
| Plain | Every other call, a call of a plain function whose return type is not definitely an Effect included (D445), and every `new` | JavaScript's call: the value is what the callee returns |
| Escape | The callee resolves to the prelude's `sync`, `try`, or `callback` | The first argument is TypeScript, run when the hatch runs (Chapter 10) |

**Rule R (run).**

- *Trigger.* A call whose callee resolves to a signature whose declared return type is **definitely an Effect**: the `Effect` interface, `Effect<A, E, R>` or `A!E!R`, with any type arguments, written directly or through a type alias whose body is one; a conditional type each of whose branches is definitely an Effect or `never`, such as the `All.Return<…>` that `Effect.all` declares; or a union each of whose members is definitely an Effect (D270). The signature is the one TypeScript resolves for the call. Its **declared return type** is the return type written in the declaration that signature comes from, or, where that declaration writes none, as an unannotated TypeScript function does, the one TypeScript infers for that declaration (D438); for a `.vibe` Effect function that is its contract (Chapter 14), and for a plain function its return annotation or, under `: infer _`, the type TypeScript infers, so a call of a plain function whose return type is definitely an Effect runs the Effect it returns (D480, D500). A type parameter in it is read by one rule, whatever construct declares it (D458), from the callee's type as TypeScript writes it, in a hover and in a declaration file alike (D491): one that the signature of the callee's type itself declares is left uninstantiated, whatever binds it, the arguments, an explicit type argument, or the call's contextual type (D378); and every other is read as TypeScript instantiates it for this call, as TypeScript shows the call's type, so one that TypeScript shows uninstantiated, as `T` in `this.get()` inside `class Box<T>`, is a type parameter there and is read as one (D486): a class's, an interface's, or a type alias's by the receiver's, the annotation's, or the alias's type arguments, and a function's or a call signature's by the completed call that returned the signature, such as the function `Effect.fn("load")(body, Effect.scoped)` or `compose(f, g)` gives, wherever that function is held (D449). An instantiation expression, `identity<X>`, is a value whose type TypeScript writes with `X` in place of `T` and no type parameter, `(x: X) => X`, so a call of it, `(identity<X>)(p)` or a call through any binding that holds it, reads that signature, while `identity<X>(p)`, a call with an explicit type argument, is a call of `identity`, whose signature declares `T` (D491). So the construct that declares a type parameter never changes whether a call runs: a type alias means what it names (D458), and a class's, an interface's, and an alias's type parameters are read alike, while a type that extends `Effect` is data whatever construct spells it (D393). A `const` bound to a call's result declares no signature of its own: its signature is the one the call returned, and an annotation on a binding that holds a function is that binding's declaration, so a call through `const load: (id: string) => Effect<User> = …` runs, as does one through `const load: Thunk<Effect<User>> = …` with `type Thunk<A> = () => A`. A callee whose type is a union of function types resolves to TypeScript's union signature, and the call runs when every member's declared return type, each read as above, is definitely an Effect; a union whose members differ, some definitely an Effect and some not, is EK4301, since its plain call would build the Effect members' programs unrun (D454, D500). A parameter's function type is read as it is written: a call of `f: (a: A) => B!E!R` runs, and a call of `f: (a: A) => B` is plain (Chapter 16, D500). Also `p()`, where `p`'s type has no call signature and is definitely an Effect or extends `Effect`, or is a type parameter whose constraint is: calling a program value runs it (D437).
- *Not a trigger.* A type parameter that the reading above leaves uninstantiated: one the signature of the callee's type declares, however it is bound, and one that TypeScript shows uninstantiated for the call; `any`; `unknown`; an intersection; a union with any other member (`Effect<A> | undefined`); and any interface or class type that extends `Effect`, whether or not it adds members of its own: `Config` (`Config.ts:113`), `Exit` (`Exit.ts:89`), a service key (`Context.ts:68`), an error instance (`Cause.ts:1312`), or a program's own `interface Job extends Effect<number> {}` (D393); and a call of a plain function or of a `trusted` value whose return type is not definitely an Effect, which is a plain call (D445, D480). A call returning one of these returns it as data.
- *Static check.* The declared return type is read as above, so nothing the call instantiates, no expected type, no annotation on the binding that receives the call's value, and no parameter the call fills changes whether it runs (D321, D378, D449, D458). The value of a call that runs has its success type A, and its E and R join the caller's contract (Chapter 14). A call that runs is EK1001 where its code runs as plain JavaScript: a module's top level, which no program runs; a class field initializer, a constructor, an accessor, or a static block, which JavaScript runs; and a parameter default, which is evaluated as plain code at the start of each run (E9) (D282). It is EK2003 under a plain contract and EK4301 in a plain callback. A call of a plain function whose return type is not definitely an Effect is not a call that runs, so none of these applies to it (below, D445).
- *Runtime.* Evaluate the callee and the arguments (rule E below), call it, and run the program the call returns on the current fiber. The call's value is the program's success value. If the program fails, the failure propagates, and nothing to the right of the call is evaluated.
- *Returns.* `return e` returns `e`'s value: returning an Effect value never runs it, whatever the contract (D321, D379). Where the success type names no value, written or contextual, returning an Effect value or a program is EK4802, an error, since the caller would get it unrun; write `return p()` to run it. So is returning a value whose type is definitely an Effect from an Effect function, wherever the function stands, unless its return annotation writes the nested Effect, as Effect's language service reports such a `return` inside `Effect.gen` (`returnEffectInGen`): its callers, VibeLang's included, would get the program unrun (D463, D480). A function that hands back a program it received is a plain function, written `: infer _`, the one spelling of a plain function whose return type is an Effect, since a written Effect type is a contract (rule F, D518): a VibeLang call of it runs that program, since its declared return type is an Effect, and a TypeScript caller receives the program (below). An unannotated function literal at a destination whose function type returns an Effect is an Effect function (rule F), so `flatMap(x, (v) => cached)` is EK4802, repaired by `(v) => cached()`, which runs `cached` in the callback's program, or by `(v): Effect<number>!! => cached` where the nesting is meant (D500). A returned function is a value, `return () => v`, and never EK4802 under the previous sentence, which is about a nested Effect; where the success type names no value, a function with no required parameters is still a program, and returning one is EK4802 under the first sentence, as Chapter 6's release `(lock) => releaseLater` is. A success type names no value when it is `void`, `unknown`, or `any`, or an unconstrained type parameter that the declared return type of the function receiving the callback does not mention (D436): `acquireRelease` drops what a release returns, so a release that returns its program is EK4802, while `ids.map((id) => () => fetchUser(id))` keeps its programs, since `map` returns `U[]`.

```ts es
const user = Users.find(id)              // a service member returning User!UserNotFound: runs
const report = loadReport(id)            // a VibeLang function: runs
const row = findUser(id)                 // a TypeScript function returning an Effect: runs
const scoped = load(id)                  // a function Effect.fn(…, Effect.scoped) returned: runs
const both = all([() => a(), () => b()]) // Effect.all's conditional return type: runs
const port = Config.Port("PORT")         // returns Config<number>: data
const done = Exit.succeed(1)             // returns Exit<number>: data
const same = identity(program)           // identity binds its own T: data, whatever T is
const held = new Box(program).get()      // get returns Box's T, here an Effect: runs
const kept = unbox(new Box(program))     // unbox<T>(b: Box<T>): T binds its own T: data
const value = port()                     // calling a program value runs it
```

**A call whose type is an Effect runs** [Rule] (D480). A call runs where the declared return type of its callee's resolved signature is definitely an Effect, whatever its callee compiles to. *Trigger:* rule R's. *Static check:* rule R's: such a call is EK1001, EK2003, or EK4301 where its code runs as plain JavaScript, a call of a plain function included. *Runtime:* a plain function is called, runs its body, and returns the program, and the program then runs on the current fiber, its success value the call's value; a call of an Effect function runs the program the call returns, and that program's success value is the call's value. An Effect function may not return a program as its success value unless its return annotation says so (*Returns*, EK4802), so a function that hands back a program it received is plain, and what a call gives never depends on what the function compiles to:

```ts es
function pick(p: number!!): infer _ { return p }          // plain: (p: Effect<number>) => Effect<number>
function pickLogged(p: number!!) { log("pick"); return p() }   // an Effect function; `return p` is EK4802

const n = pick(load)                                      // runs load: n is a number
const m = pickLogged(load)                                // logs, then runs load: m is a number
const held: number!! = () => pick(load)                   // runs nothing: held is a program
const again = held()                                      // runs load
```

To hold a program unrun, write a function where an Effect type is declared: rule D's conversion makes the arrow the Effect, and each run of it calls the function, so `held` runs `load` each time it runs. An annotation on the receiving binding holds nothing: `const n: number!! = pick(load)` runs the call where it stands, so it is EK1018, whose quick fix writes the `() =>`. A TypeScript caller receives `pick` as `(p: Effect<number>) => Effect<number>`, and its call gives `load` back unrun, as the type says; a VibeLang call runs it, as it runs a call of any function declared to return an Effect. Passing `pick` is not calling it, and a function value's form is its type's (rule F): `pick`'s type returns an Effect, as an Effect function's does, and no declaration tells the two apart, so `xs.map(pick)` is EK4301, from source and from declarations alike, as `xs.map(run)` is for `function run(p: number!!): number!! { return p() }`, whose declaration is the same (D492, D511). To collect the programs as data, write the plain literal, `xs.map((p): infer _ => p)`; `xs.map((x) => pick(x))` is EK4301 too, since that literal is plain at `map`'s destination and its call of `pick` runs; write `forEach(xs, (x) => pick(x))` to run them. Written without the annotation, `function pick(p: number!!) { return p }` is an Effect function that returns a program as its success value: EK4802 (D480, D500).

"Definitely" keeps the rule independent of what a call infers. `identity` returns whatever it receives, and a TypeScript reader expects `identity(program)` to hand back the program, so a call of a generic callee whose declared return type is its own type parameter `T` returns data, whatever this call binds `T` to (D378); write `identity(program)()` to run it. That is the one place instantiation is set aside: every other type parameter is read as TypeScript shows it for the call, whatever construct declares it (D458). So `new Box(program).get()` runs, since `get(): T` names `Box`'s `T`, which the receiver's type fixes, as `makeBox(program).get()` runs for `makeBox<T>(x: T): { get(): T }`; `Function.constant(program)()`, whose result Effect declares through its alias `LazyArg<A>`, runs as the same type written inline does; and `[a, b].reduce((acc, x): infer _ => acc, initial)` over Effects runs, since `reduce(f, initial: T): T` returns the array's own `T`; the callback is plain, written `: infer _`, since an unannotated literal there would be an Effect function that returns a program, EK4802 (D500). `unbox(new Box(program))`, a call of `unbox<T>(b: Box<T>): T`, returns data, since `unbox` binds its own `T`, and so does `[a, b].reduce<Effect<number>>((acc, x): infer _ => acc, initial)`, which selects `reduce`'s own `U`. A call hands back as data only what its own callee is generic in: read a container's Effect without running it through a property, `box.value`, or a function generic in it. Inside a generic declaration, TypeScript shows its own type parameters uninstantiated, so in `class Box<T>`'s own methods `this.get()` returns data, while `other.get()`, with `other: Box<Effect<number>>`, runs there as it runs anywhere, since TypeScript shows it `Effect<number>` (D486). An instantiation expression is a value of the type TypeScript writes for it, which declares no type parameter it bound: with `const idE = identity<Effect<number>>`, whose type is `(x: Effect<number>) => Effect<number>`, `idE(program)` runs the program, through a `let`, a field, or a declaration file alike, while `identity<Effect<number>>(program)` returns it (D491). A function that a completed call returned is read as that call bound it, as TypeScript shows it (D449): Effect's `Effect.fn("load")(body, Effect.scoped)` declares its result `(...args: Args) => A`, with `A` its own type parameter, which the call binds to the pipeline's `Effect`, so a call of `load` runs, wherever `load` is held. Composing an Effect function with `flow` does not compile: `flow(parse, fetchUser)` passes `fetchUser` where `flow` expects a function returning its own type parameter, a destination of the plain form, where an Effect function is EK4301; write `(raw) => fetchUser(parse(raw))` (D435). `Effect.all` returns an Effect for every argument it accepts, so every call of it runs. A `Config` stays data so that `Config.withDefault(Config.Port("PORT"), 3000)` composes before anything reads the variable, and a function that returns `new InvalidId({ raw })` returns the error instead of failing with it.

**Calls of plain functions** [Rule] (D445, D500). A call of a plain function is JavaScript's call of it, wherever it stands; so is a call of a `trusted` value, which is one plain function (D514). It is a plain call unless the function's declared return type is definitely an Effect, when the call runs the Effect the function returns (rule R, D480).

- *Trigger.* A call whose callee is a plain function: a VibeLang function or method with a plain return annotation or `: infer _`, a class's plain method (D397), a function value whose type is a plain function type, such as a parameter typed `(a: A) => B`, a plain function a module in the compiler's manifest declares (Chapter 27), a trusted built-in, or a `trusted` value, a plain function whose type, `Trusted<F, Errors>`, is `F` with the exception classes it lists (D400, D514). A union callee is one when each of its members is; a union whose members differ in form is EK4301 (rule R). A function with an Effect contract, or with no return annotation, is not a plain function, whatever its body (D421, D500).
- *Kind.* The call's signature is the function's own, and its return type is the declared return type rule R reads. Where it is not definitely an Effect, the call is Plain, and its value is what the body returns; where it is, as for `pick` above, the call is Run: it calls the function and runs the program the body returns, and its value is that program's success value (D480). A `trusted` value's listed failures are expected failures (D399).
- *Static check.* Rule P's, so the call is legal in plain code, the places where code runs as plain JavaScript, as it is in an Effect function: at a module's top level, in a class field initializer, a constructor, an accessor, a static block, or a parameter default, in a function with a plain contract, and in a plain callback. A call whose return type is definitely an Effect runs a program, so it is rule R's EK1001, EK2003, or EK4301 in those places (D480). A `trusted` value's listed failure that can escape is EK2003 under a plain annotation, EK4301 in a plain callback, EK1001 at a module's top level, in a class field initializer, or in a parameter default, and EK2003 in a constructor, an accessor, or a static block (D455). The kind follows the callee's written form, never an optimization: a call of an Effect function is a call that runs, EK1001, EK2003, or EK4301 in those places, even where the compiler gives that function a plain variant, so no compiler setting changes which programs compile.
- *Runtime.* JavaScript's call: it binds the parameters, runs the body once, synchronously, and returns its value, which the call then runs on the current fiber where the return type is definitely an Effect (D480). The plain call itself starts no fiber, calls no runner, and builds no program. A plain function, or a `trusted` value, performs no Effect operation, needs no service, and fails only as its contract lists. An exception that no contract lists is a defect: it propagates as the exception it is through plain code, and becomes `Die` where it reaches an Effect function. Before the exporting module's body has run, as in a module cycle, the call reaches the hoisted function, as JavaScript's does (Chapter 26).

```ts es
// helpers.vibe
export function double(n: number): number {   // a plain function
  return n * 2
}

export function twice(n: number) {            // no annotation: an Effect function, number!!
  return n * 2
}
```

```ts es
// consumer.vibe
import { double, twice } from "./helpers.js"

export function plain(n: number): number {
  return double(n)                            // twice(n) here: EK2003
}

export function mapped() {
  return [1, 2].map((n) => double(n))         // [2, 4]; twice(n) here: EK4301
}

export const initial = double(3)              // 6; twice(3) here: EK1001
```

`plain(3)` is 6. Compiled against `helpers.d.ts`, which declares `double` as `(n: number) => number` and `twice` as `(n: number) => Effect.Effect<number>`, `consumer.vibe` compiles and gives the same values, and the compiler's manifest marks `double` as a VibeLang plain function a consumer may call from plain code (Chapter 27, D500). `twice` performs no Effect operation, but its form is written, not read from its body: it is an Effect function, as it would be with the contract `: number!!`. In an Effect function a call of `twice` runs, and may cost what a call of `double` costs, through the plain variant the compiler gives it (Chapter 15), but its declaration says it is an Effect, and a caller sees the declaration, not the body (D421). The quick fix for each of the three errors writes `twice`'s return type, `: number`, which makes it plain to VibeLang and TypeScript callers alike.

**Declarations keep the reading** [Rule] (D458, D491). Rules R and F read a callee's or a function value's type as TypeScript writes it, in a hover and in a declaration file: its signatures, the type parameters each signature declares, and every other type parameter instantiated as the type shows it. Nothing they read is a fact that TypeScript's checker keeps and declaration emit drops, such as the generic declaration an instantiation expression or an extracted method came from. Declaration emit writes that type: an exported `const` bound to an extracted or bound method, an instantiation expression, a returned callback, or a property of an inferred object type is written with the instantiated type TypeScript infers, and a generic signature keeps its own type parameters. So a call compiled against a declaration file reads what a call compiled against the source reads, for the `.ts` files the compiler compiles as for `.vibe` files, and for a declaration stock TypeScript emitted too: `export const read = new Box(Effect.succeed(1)).get`, `export const idE = identity<Effect.Effect<number>>`, and `export const composed = compose(parse, (n: number) => Effect.succeed(n))` in a `.ts` file run from their source and from their declarations alike (D449), and `read` and `idE` are Effect functions to both, since their types return an Effect, so passing either where only a plain function fits is EK4301 to both (D492). Chapter 14's check reads a member of an object type by the member's declaration, which a declaration file keeps with the type (D485, D492). Declaration emit writes no alias for this, and the runtime no longer exports the `AsData<T>` that D426 had it write.

**Rule P (plain).** *Trigger:* every call that is not of kind Run or Escape, and every `new C(…)`. *Static check:* the callee is a plain VibeLang function, a function value of a plain function type, a plain function a module in the compiler's manifest declares (Chapter 27), or a trusted function; any other TypeScript or JavaScript function is EK4401, a platform API EK4402, and a clock or randomness read EK4403 (Chapter 10). *Runtime:* JavaScript's call. A plain call that returns an Effect value returns it as data: discarding it is EK4801, and returning it where the success type names no value is EK4802.

**Rule X (escape).** Chapter 10 defines the hatches.

| The callee is | Kind | Generated |
| --- | --- | --- |
| A VibeLang function or method with a plain return annotation, `: infer _` included (D67, D500), a class's plain method (D397), or a plain function a module in the compiler's manifest declares | Plain, in plain code too (D445); Run where its return type is definitely an Effect, the call and then a run of the Effect it returns (D480) | `f(a)`; a method keeps its receiver, `o.m(a)` (E1, L1); `yield* f(a)` where it runs |
| Any other VibeLang function: one without a return annotation, or with an Effect contract (D500) | Run | `yield* f(a)`, or its plain variant, `f$direct(a)` or `f[$direct](a)`, where the compiler gives it one (Chapter 15, D421) |
| A TypeScript function whose declared return type is definitely an Effect | Run | `yield* f(a)` |
| A TypeScript function whose R contains a control operation | Rejected in v0: EK4202 (Chapter 9) | |
| A program value, `p()` | Run | `yield* p` |
| A function value of a function type, such as a parameter, `f(item)` in Chapter 16's `mapAll` | Run where its type returns a definitely-Effect type, `f: (a: A) => B!E!R`; Plain where it returns another, its exceptions defects (Chapter 10, D500) | `yield* f(item)`; `f(item)` |
| A service member, `Users.find(id)` | Lookup, then Run or Plain by the member's type | `yield* (yield* Users).find(id)`; `(yield* Path).join(a, b)` |
| A control operation, `Approval.approve(x)` | Lookup, then the nearest handler on this fiber | `yield* (yield* Approval).approve(x)` |
| A method of an Effect data type, `fiber.join()` | The module's function, then Run or Plain by its type | `yield* Fiber.join(fiber)`; `Stream.take(stream, 3)` |
| A JavaScript built-in, or an `effect` export that does not return an `Effect` | Plain, trusted: listed exceptions are expected failures in every function (D399) | `f(a)`, with listed exceptions converted |
| A TypeScript function wrapped with `trusted(impl, [Errors])` (D249, Chapter 10) | Plain, trusted, in plain code too, whose listed exceptions are expected failures in every function (D399, D400, D445, D514) | `f(a)`, with listed exceptions converted |
| A TypeScript function with the deprecated `@vibelang trusted` tag (D23) | Plain, trusted, with warning EK4406 (D249) | `f(a)`, with listed exceptions converted |
| Any other plain TypeScript or JavaScript function | Rejected: EK4401 (Chapter 10) | |
| A platform API, or a clock or randomness read | Rejected: EK4402, EK4403 (Chapters 10, 11) | |
| `sync`, `try`, `callback` | Escape | Chapter 10 |
| `new C(…)` | Plain: constructs, never runs a program | `new C(…)` |

Because the kind of a call depends on its callee's declared signature, the compiler needs TypeScript's type checker, not a source transform, so VibeLang is a fork of the TypeScript compiler (Chapter 27). These rules define the language. An implementation that cannot apply them to a program rejects the program; it never gives the program another meaning.

#### Services, control operations, and data-type methods

Three call forms are shorthand for calls that rules R and P already cover. Each is recognized by the symbol its receiver resolves to (rule H).

- **Services.** Where `S` resolves to a service key, a `service` declaration, a `Context.Service` class, or a module whose name names its key (D311, D369), `S()` looks the implementation up in the current Context: a call that runs and adds `S` to R. `S.m(args)` is `S().m(args)`: the lookup, then the member, then the arguments, then the call, which runs when the member's declared type returns an Effect and is a trusted plain call otherwise. `S.v()`, where the member `v` is an Effect value, looks the service up and runs `v`. A value member read without a call is EK4503, a member named like a property of the key's own class included, such as `name` or `length`, which the key would otherwise answer with the class's own (D388).
- **Control operations.** `C.op(args)`, where `C` is a control declaration, looks the operation up as a service call does and asks the nearest handler on this fiber (Chapter 9).
- **Data-type methods.** `x.name(args)` is `Module.name(x, args)` (D152) when all of these hold: the access is in a `.vibe` file and not in an optional chain; `x`'s type, with type parameters resolved to their constraints, has no member `name` of its own; one of Effect's data-type modules declares `x`'s type, and for a union every member comes from the same module, as `None` and `Some` come from `Option`; and the method table lists `Module.name`. The table holds each function whose data-first overload takes the module's type first. It is generated from the declarations of the Effect version the runtime pins, ships with the compiler, and changes only with a VibeLang release that changes that pin (D336). A parameter's name plays no part.

The method's signatures are its data-first overloads with the first parameter moved to `this`; a curried overload, such as `Stream.zipLeft(right)`, is not one of them. TypeScript checks `x` against it, infers type parameters from it, and narrows `x` by a type predicate on it:

```ts es
function describe(value: Option.Option<number>) {
  if (value.isSome()) return `some ${value.value}`   // Option.isSome(value): value is Some<number>
  return "none"
}
```

The call compiles to `Module.name(x, args)`, and rules R and P apply to that call: `Fiber.join` returns an `Effect`, so `fiber.join()` runs; `Stream.take` returns a `Stream`, which is data. The method exists only in a call: `const read = maybe.getOrElse` is EK4501 (D153), because no function value exists to bind; pass `Option.getOrElse` itself.

#### Programs are built by syntax

**Rule D (delay).** *Trigger:* these forms, and no others, build a program.

| Form | The program it builds |
| --- | --- |
| A function literal: `() => e`, `() => { … }`, `function () { … }` | Its body, run each time the function is called |
| A block after a call, `f(args) { … }` (D188) | `() => { … }`, always `f`'s last argument (D376) |
| `fork e`, `fork(e)`, `fork { … }` (D166, D391, D452) | `() => e`, run on a new fiber |
| Each element of an array or object literal written as the operand of `await.all`, `await.allSettled`, `await.race`, or `await.any`, parenthesized or not, whatever its type (D196, D377, D462) | `() => element`, each started on its own fiber |
| `x catch y` and `x catch (e) => …` (D236) | `x`, run at once, where the expression stands, as the body of a catch region; `y`, evaluated only after `x` fails with an expected failure (D518) |
| The block of `provide L { … }`, `uninterruptible { … }`, `restore { … }`, `interruptible { … }`, and a `for concurrent` body | The block |
| A hatch's first argument | TypeScript, run when the hatch runs (Chapter 10) |

*Static check:* the form's own; among them, an element of an await operation's literal operand, or a `fork` operand, whose type is a program is EK4613, since its result would be that program unrun (D394, D433). *Runtime:* evaluating the form evaluates nothing inside it. Each run evaluates the body from the start (rule E8).

A program passes to a TypeScript API in the representation the API declares. Where the declared type at the destination is the `Effect` interface, or a type parameter whose constraint includes it and no function type, a function with no required parameters, written there or passed as a value, is passed as an `Effect` that calls the function each time it runs (D7, D69, D381). The same holds for a declared variable, field, contextually typed object-literal field, or contextually typed array-literal element whose type is an Effect: `const tick: void!! = () => log("tick")` holds a program. Conversion itself runs none of the function's body: building the `Effect` runs nothing and reads nothing but the function value, and each run of the program calls the function. A function literal converted at a destination of type `Effect<A, E, R>` is typed as the same literal at `() => A!E!R` would be: its returns are checked against A, which also gives them their contextual type, as a returned object literal's methods take theirs from A; and its inferred E and R are checked against the destination's, as TypeScript checks the `Effect` it becomes, so a type parameter among them is inferred from the literal, as `Layer.effect`'s are (D518).

**Collections** [Rule] (D49, D111, D423). Only a literal converts element by element. Where a destination's element or field type converts functions to programs, an array literal written there converts each element after evaluating it, in order, and an object literal each field, as rule F converts any function at its destination. The elements a spread in such a literal supplies convert as the spread reads them, by their static types, never by a run-time test: a tuple's element by its position's type, an object's property by its own type, and an array's or iterable's elements by its element type (D453). A function type with no required parameters converts, and an element type that mixes one with other members does not, so TypeScript's type error names it. The spread reads its iterable or object as ECMAScript's spread does: once, at its place in the literal. Any other value, a variable, a call's result, a `Set`, or a record built elsewhere, is passed as the value it is, and nothing traverses it for the destination: where its elements or fields are functions and the destination expects Effects, the call is TypeScript's own type error, whose note and quick fix write the traversal as a spread, `all([...jobs])` or `all({ ...jobs })`. So no parameter type makes a call read a collection that its operands only name.

```ts es
function runAll(jobs: ReadonlyArray<() => number!!>) {
  return all([...jobs], { concurrency: 4 })   // the spread reads jobs here, once
}
```

```ts gen
// retry(() => syncInventory(store), Schedule.recurs(3))
yield* Effect.retry(Effect.gen(function* () { return yield* syncInventory(store) }), Schedule.recurs(3))
// retry(job, Schedule.recurs(3)), with const job = () => syncInventory(store)
yield* Effect.retry(Effect.suspend(job), Schedule.recurs(3))
```

**A call where a program is expected.** A call that runs, written where the declared type at its destination (see Function values, below), or an element or field type of it, is the `Effect` interface or a function with no required parameters that returns one, runs before anything receives it. Unless its success value is itself a program, an Effect or a function with no required parameters, that is EK1018, whose quick fix writes `() =>` before the call (D395): `retry(makeSync(store), policy)` passes the program `makeSync` returns and is accepted. It covers arguments, array elements, object-literal fields, and initializers of a `const`, a `let`, or a field declared with an Effect type:

```ts es
function load(id: string) {
  return retry(fetchUser(id), Schedule.recurs(3))
}
```

```text
error EK1018: fetchUser(id) runs here, before retry receives it, but retry expects a program.
  load.vibe:2:16   return retry(fetchUser(id), Schedule.recurs(3))
  Write () => to pass the program:   retry(() => fetchUser(id), Schedule.recurs(3))
```

EK1018 also covers a call whose success type is `never`, such as `race(Effect.fail(a), Effect.fail(b))`: the first call would fail before `race` started.

Most sites the earlier rules passed by name now fail to type-check, and EK1018 names them. A site whose old and new meanings both type-check would change silently: a call passed by name whose success value is itself an Effect, a held `const` or field of such a type, or a factory whose success type accepts the function it returns. A migration analyzer that knows the earlier rules reports each such site as EK1023, an error, and `--fix` rewrites it into the syntax that keeps its old meaning. A factory is TS2322 at its return, since a function is not its success type; `--fix` rewrites one that is not exported into a plain function that returns the program, and refuses an exported one with EK1023, never guessing its TypeScript API (D382, D390).

Earlier versions passed such calls by name, held typed initializers, made some functions factories, and ran some returned values; each of those sites now gets its behavior from syntax:

| Earlier form | Now | Where the behavior comes from |
| --- | --- | --- |
| `retry(fetchUser(id), policy)` | `retry(() => fetchUser(id), policy)` | A function literal (rule D) and its conversion |
| `fork(fetchReport())` | Unchanged, or `fork fetchReport()` | The `fork` keyword, with or without parentheses (rule H5, D391) |
| `Effect.all([a(), b()])` | `await.all [a(), b()]`, or `all([() => a(), () => b()])` | The await operation; function literals |
| `timeout(slow(), "1 second")` | `timeout(() => slow(), "1 second")` | A function literal |
| `fetchUser(id) \|> retry(%, policy)` | `retry(() => fetchUser(id), policy)` | The pipe's topic is a value (Chapter 5) |
| `pipe(() => fetchUser(id), retry(policy))`, a program by look-ahead (D110) | `retry(() => fetchUser(id), policy)` | A function literal; `pipe` passes its first argument as the value it is (D383) |
| `withSpan("load") { … }`, placed by the callee's type (D188) | `withSpan(() => { … }, "load")` | A function literal; a block is always the last argument (D376) |
| `race(do { … }, fetched())` | `race(() => { … }, () => fetched())` | Function literals |
| `const p: number!! = make()` | `const p = () => make()` | A function literal |
| `{ read: work() }`, where `read` is an Effect | `{ read: () => work() }` | A function literal and its conversion |
| `all(jobs)`, with `jobs` an array of functions, read into a new array at the call (D419) | `all([...jobs])` | A spread in an array literal, whose elements convert (D423) |
| A factory: `(input): number!! => { …; return () => snapshot }` | A plain function returning a program, or TypeScript (Chapter 5); `--fix` refuses an exported one with EK1023 | The returned function literal |
| `return exit` in an Effect function, run because an `Exit` does not fit A (S22-3) | `return exit()` | A call of a program value (D379) |
| `HttpRouter.add("POST", "/users", createUser())` | `HttpRouter.add("POST", "/users", () => createUser())` | A function literal |
| `NodeRuntime.runMain(main())` | An exported `main` with a platform import (D312), or `NodeRuntime.runMain(main)` | The entry, or a function value |

#### Programs and continuations

This document has two kinds of "rest of the work", and they behave differently: a **program** is the reusable kind; a **continuation** is the `k` a handler receives in Chapter 9.

| | Program | Continuation |
| --- | --- | --- |
| What it is | A description of work that has not started | The rest of one particular run, paused at a call |
| Created by | A form of rule D; importing an `Effect` | A control operation, when a handler receives it |
| How many times it runs | Every time it is run | At most once |
| Retry | Runs it again from scratch, with fresh local variables | Impossible: it has been used |
| Other fibers | Can run on any fiber (`fork`) | Only on the fiber that created it |
| Type | `() => A` with contract `Effect<A, E, R>`, or `Effect<A, E, R>` where a declared type asks for one | `Continuation<V, E, H>`, usable only inside its clause (Chapter 9) |

#### Function values

A function literal, or a named function used as a value, is always a function: nothing turns it into a call. Every function has one **form**, which its type shows wherever it is held. A **plain function** is a JavaScript function: a call runs the body and returns its value. An **Effect function** returns a cold program: a call runs none of the body, and each run of the program it returns runs the body afresh. A VibeLang caller of an Effect function does the body's work at the call, since a call of it runs the program it returns (rule R); a TypeScript caller, or an API that receives the function, decides whether and when that program runs. A **program** is an `Effect` that calls a function with no required parameters on each run (D381). A function never becomes a program because its body can pause: `HttpRouter.add("GET", "/health", () => checkHealth())` passes a handler function, whatever `checkHealth` does, and the router calls it.

**Rule F (written forms)** [Rule] (D500; controversial, Chapter 29).

- *Declarations.* A function declaration, function expression, arrow function, or method is an Effect function, unless its return annotation is a type that is not definitely an Effect, in rule R's sense, or `infer _`: then it is a plain function, to VibeLang and TypeScript callers alike (D67). An Effect contract, `(n: number): number!!`, keeps it an Effect function. Its body never decides its form: a body that only computes leaves an unannotated function an Effect function, `number!!`, and a body that runs an Effect under a plain annotation is EK2003 (D282). `infer _` lets TypeScript infer the plain function's return type from its body, as it infers an unannotated TypeScript function's. A plain declaration decides how the function compiles, one JavaScript function whose body is checked as plain, and so what TypeScript callers receive; as a value, it has the form its type gives, as every function value does (below): one whose return type is definitely an Effect, as `pick`'s is, is held and passed as an Effect-form value, since its type is an Effect function's (D511). A class's unannotated method is an Effect method, unless it is a protocol method or implements a plain member its class declares, which makes it plain (Chapter 10, D397). Producers, constructors, accessors, and static blocks are not functions in this sense (Chapter 8, D282).
- *Function literals.* A function literal at a destination takes the form the destination's declared type gives it, as the table below says, and never its body's: an Effect function where the type's function returns a definitely-Effect type, a program where the type is an `Effect`, and a plain function where the type is any other function type, `Function`, or a type parameter whose constraint is one of these, as TypeScript takes the literal's contextual signature from that constraint (D513). A destination of any other type, `any`, `unknown`, `object`, or an unconstrained type parameter, gives no form, and a literal there is an Effect function, as one with no destination is (the table's last row). A return annotation on the literal decides its form instead, by the first bullet, so `(x): number!! => …` is an Effect function wherever it stands, EK4301 where only a plain function fits, and `(x): number => …` is a plain function. A literal with no destination, `const half = (n: number) => n / 2`, is an Effect function, by the first bullet. So moving a literal from its destination into an unannotated `const` changes its form: at a plain destination the extracted function is EK4301, and at one that accepts both forms, as `once` below, it is passed as an Effect function where the literal was plain; write the form on the extracted literal, `const bump = (): number => …`, to keep the literal's (D518). An object literal's method, and a function literal written as an object literal's field, is a function literal at its field's destination; a field at a protocol key is a destination of the plain form, whatever the literal's contextual type (Chapter 10, D484).
- *Function values.* Any other function value, a name, a member, an element, or a call's result, has the form its type gives, as TypeScript writes that type, read as rule R reads a call of it: plain where its return type is not definitely an Effect, Effect where it is (D492). It is held and passed as it is. At a destination, TypeScript's assignability decides whether it fits, with Chapter 14's rule that an Effect never satisfies a plain function type (D430): an Effect function where only a plain function fits is EK4301, and so is a plain function whose return type may be an Effect, a union with a definitely-Effect member, where the destination's return type has no such member (D512); and a plain function whose return type is not an Effect, where only an Effect function fits, is TypeScript's assignability error; write a literal there, `(x) => slugify(x)`, which takes the Effect form. A function with no required parameters, of either form, converts to a program where the declared type is an `Effect` (rule D).
- *Destinations.* The declared type at a destination is the parameter type of the signature the call resolves to, a declared variable, field, or return type, or the field type of a contextually typed object literal or the element type of a contextually typed array literal (D44, D423). A field whose contextual member a class, an interface, or a type alias declares reads that declaration, with its declaring type's own type parameters left uninstantiated, as Chapter 14's check reads it: under `Source<number!!>`, with `interface Source<T> { get(): T }`, a literal's `get` is at a destination that returns a type parameter, which gives the plain form (D492). A destination reaches an expression inside parentheses, a conditional's arms, both operands of `??` and `||`, the right operand of `&&` and of a comma, and the operand of `satisfies`, as TypeScript's contextual typing does, never the operand of `as`, which asserts a type and converts nothing (D453, D461, D488). So `retry(job ?? (() => a()), policy)` converts the operand whose value it takes to a program, and `cond && (() => a())` converts only its right operand, as TypeScript types only that one by the destination.
- *Overloads* [Rule] (D482, D510). An overloaded call resolves by TypeScript's procedure: TypeScript tries the candidates in declaration order, after its `reorderCandidates` step, by its subtype relation and then by assignability, and the first that accepts the call is the signature the call resolves to. TypeScript types a function literal argument once, with the contextual type that the first candidate it checks the literal against gives it, and keeps that typing for every later candidate (D450); the literal takes the form that candidate's destination gives it, and its body is checked in that form. The type every candidate checks the literal against is its type in that form: its parameters as that first candidate typed them, and its return type the body's, wrapped as `Effect<A, E, R>`, with A the type its returns give and E and R what its body fails with and needs, where the form is Effect. So a literal whose body returns a number, first checked against a candidate whose callback returns an Effect, is an Effect function of type `(…) => Effect<number>`, which that candidate accepts, where stock TypeScript, which never wraps a literal, would pass over it to the next. This and Chapter 14's rule in the next sentence are the two places VibeLang's resolution differs from stock TypeScript's, and each follows from a form, not from a second procedure (D510). A candidate accepts a function argument by TypeScript's assignability and Chapter 14's rule (D430, D453), never by what the argument's body does. Only when no candidate accepts the arguments, where TypeScript would report that no overload matches, are the candidates tried again with each function argument that has no required parameters converted to a program where a candidate's parameter is an `Effect`; then a candidate that takes it as a function ranks above one that converts it, and the two are no tie (D380). EK1021 is reported only there, when two function arguments prefer different candidates. So `Effect.tap(self, (a) => …)`, `Effect.catchIf(load, isNotFound, (e) => …)`, and `rows.reduce((acc, x) => [...acc, ...x], [])` type their literals as TypeScript does, and none is EK1021.
- *Rough edge* (D482, D494, D500, D510). A literal's typing and its form come from its destination, so the order of a library's overloads, and the call's own contextual type, such as an annotation on the binding that receives the call, decide them, as they decide a callback's parameter types in TypeScript. What they decide is exactly this, and nothing else about the call: the literal's parameter types, whether it compiles, and, for a literal that compiles in either form, its form. A literal whose body runs an Effect where its destination gives the plain form is EK4301, whose quick fix writes an Effect return annotation or a parameter type that keeps the body plain. A literal whose body performs no Effect operation compiles in both forms, so for it the first candidate checked decides when its body runs: plain, its body runs each time the receiver calls it; an Effect function, the receiver's call builds a program, and the body runs each time the receiver runs that program, never if it runs none. With `consume(f: () => number)` declared before `consume(f: () => Effect<number>)`, `consume(() => { events.push(1); return 0 })` is plain and pushes once per call `consume` makes; with the two declarations in the other order it is an Effect function, `consume` receives a program, and it pushes once per run of that program, never if `consume` only calls the function. No diagnostic reports this; reordering a library's overloads, or changing the annotation that gives a generic call its contextual type, is therefore a change to its callers' behavior, as G22 records, and the fix is a written form: `(): number => …` or `(): number!! => …` takes the same overload and the same form under either order (D510). Whether an argument other than a function is evaluated, and when, never depends on the order. With `consume(f: (run: () => number) => number | Effect<number>)` declared before `consume(f: (run: () => Effect<number>) => number | Effect<number>)`, `consume((run) => { run(); events.push(1); return 0 })` types `run` as `() => number`, the literal is plain, as a literal at a destination that accepts both forms is, and `consume`'s call of it pushes once; with the two overloads in the other order, `run` is `() => Effect<number>`, `run()` runs an Effect in a plain function, and the call is EK4301. With `keep<T>(cb: (x: T) => number | Effect<number>): (x: T) => number | Effect<number>`, `const f: (x: Data) => number | Effect<number> = keep((x) => { x.run(); events.push(1); return 0 })` types `x` as `Data`, whose `run()` returns data, and compiles; the same line written with `Job`, whose `run()` returns an Effect, is EK4301. Write the form to choose it: `(run): number!! => …` is an Effect function under either typing, which `consume` receives as a program and may never run, as its type says it may; `(run: () => number) => …`, `(x: Data) => …`, or `keep<Data>(…)` gives the body one typing. Prior art: TypeScript's overload resolution, which picks the first matching overload in declaration order and types a callback once from it, and whose handbook asks libraries to declare the most specific overloads first; and TypeScript's inference from a call's contextual type, which types `a` in `pipe(load, Effect.map((a) => a + 1))` from `pipe`.
- *Runtime.* A plain function is the JavaScript function; an Effect function, a function that returns an `Effect` that runs the body each time it runs; a program, an `Effect` that calls the function each time it runs.

A type parameter at a destination is read by one ordered rule (D435). One whose instantiation TypeScript infers from another argument, the receiver, an explicit type argument, or the call's contextual type, such as an annotation on the binding that receives the call, is read as that instantiation, as `push`'s element type is for `jobs.push(() => run())`, and as TypeScript types the function's parameters from it (D494). One whose only source is the function itself is read as not an Effect, since reading it would make the function decide its own form: as the return type of the destination's function type, as `Array.prototype.map`'s `U` is, the destination gives the plain form; as the whole destination type, it gives the form its constraint gives, since TypeScript takes the literal's contextual signature from that constraint: plain for a constraint that is a function type returning any type that is not definitely an Effect, `T extends (...args: any[]) => any`, or `Function`; Effect for one whose function type returns a definitely-Effect type; and none for an unconstrained `T` or any other constraint, so a literal there is an Effect function, as one with no destination is, and a function value keeps its own (D513). A function value at such a `T` is checked against the constraint by Chapter 14's rule, so an Effect function at a plain-function constraint is EK4301. This rule reads a type parameter only where it is a function value's whole destination or a destination function type's return type; the element and field types of a literal argument are the contextual types TypeScript derives, through the constraint of a type parameter the call has not fixed, as `Effect.all`'s `Arg extends Iterable<Effect<any, any, any>> | Record<string, Effect<any, any, any>>` gives each element of `all([() => a(), () => b()])` an Effect type (D453). A constraint includes an Effect when it is definitely an Effect or a union with a member that is. A destination type's `null` and `undefined` members are ignored, as TypeScript ignores them when it finds a contextual signature, so an optional callback typed `((e) => boolean) | undefined` gives what `(e) => boolean` gives; "definitely an Effect" here is rule R's (D395).

| Declared type at the destination | A function literal there is | A function value there |
| --- | --- | --- |
| A function type whose return type is definitely an Effect, or a type parameter that only the function fixes whose constraint is one | An Effect function | Accepted where its type returns a definitely-Effect type, a plain function's included, as TypeScript accepts it; any other is TypeScript's assignability error |
| A function type returning any other type, `void`, `unknown`, `any`, and a type parameter that only the function fixes included, as `Array.prototype.map` expects; `Function`; or a type parameter that only the function fixes whose constraint is such a type, as lodash's `once<T extends (...args: any) => any>(func: T): T` declares (D513) | A plain function; a body that can pause, or let a `throw` or a listed failure escape, is EK4301 (D399) | Accepted where plain and its return type has no definitely-Effect member; an Effect function, or one whose return type may be an Effect, is EK4301 (D430, D512) |
| A function type whose return type is a union of a definitely-Effect type and other types, `boolean \| Effect<boolean>` | A plain function, unless its return annotation makes it an Effect function (D112) | Accepted in either form: the destination declares that it accepts both, and what it receives, a value or a program, is what the function is |
| `Effect<A, E, R>`, or a type parameter whose constraint includes an Effect and no function type | A program, for a literal with no required parameters (rule D's conversion) | A program, for a function with no required parameters, of either form |
| A type that includes both a function type and an Effect, as `HttpRouter.add`'s handler does | What its function member gives; never a program | What its function member accepts; never a program |
| None, as for a function that another function returns where no return type is declared, or a type that is none of the above, such as `any`, `unknown`, `object`, or a type parameter that only the function fixes and whose constraint, if any, is none of the above | An Effect function, as a literal with no destination is | Its own form |

```ts dts
// helpers.d.ts: a plain callback first, an Effect callback second
import { Effect } from "effect"

// The package is listed in vibelang.trustedPackages (Chapter 10).
export declare function register(f: (x: number) => number): string
export declare function register<E, R>(f: (x: number) => Effect.Effect<number, E, R>): Effect.Effect<string, E, R>
```

```ts es
const a = register((x) => Math.max(x, 0))                    // overload 1 gives the plain form: a plain call
const b = register((x) => Users.find(String(x)).id.length)   // EK4301: overload 1 makes the literal plain, and its body runs an Effect
const c = register((x): number!! => Math.max(x, 0))          // an Effect function: overload 2, and the call runs
```

TypeScript checks each literal against overload 1 first. `a` fits it as a plain function. `b` is plain there too, since its destination gives it that form, so its call of a service is EK4301, whose quick fix writes `c`'s annotation; overload 1 does not accept an Effect function (D430), overload 2 does, and the call runs, as the overload a call resolves to decides whether a TypeScript call returns a `Promise`. An unannotated `double` passed as a value, `register(double)`, is an Effect function, so overload 2 takes it, as it does for a TypeScript caller of `double`. Every argument other than a function is evaluated as a value, once, whatever the candidate.

The form a function is passed in is observable to the code that calls it. A trusted TypeScript API declared `once(f: () => number | Effect<number>): void`, which calls `f` once and drops the result, receives `() => { count++; return count }` as a plain function, since its destination accepts both forms and a literal there is plain, and the call adds one to `count`; written `(): number!! => { count++; return count }`, the same function is an Effect function, the call builds a program that `once` never runs, and `count` is unchanged. Each is what the destination declares it accepts, and the source's annotation decides which (D112, D447, D500). A generic wrapper that returns the function it receives, as lodash declares `once<T extends (...args: any) => any>(func: T): T`, `memoize`, and `debounce`, and React declares `useCallback<T extends Function>`, gives a literal the plain form through its constraint: `const init = once(() => { n++ })` makes `init` plain, so `init(); init()` adds one to `n`, as in TypeScript; `useCallback((e) => log(e), [])` is EK4301, since its body runs an Effect at a plain destination; and `once(fetchUser)`, with `fetchUser` an Effect function, is EK4301, since it does not satisfy the constraint (Chapter 14, D513). At `identity<T>(x: T): T`, whose `T` has no constraint, a literal is an Effect function and a function value keeps its form.

**Function kinds** [Rule] (D421, D500). One table gives each kind of function its form, what a VibeLang call of it is, whether plain code may call it, what TypeScript code receives and its declaration file writes (Chapter 27, rule 3), and what happens where only a plain function fits. **Plain code** is code that runs as plain JavaScript: a module's top level, a class field initializer, a constructor, an accessor, a static block, a parameter default, a function with a plain contract, and a plain callback (rule R).

| Function | Form | A VibeLang call | In plain code | TypeScript code receives, as its declaration writes | Where only a plain function fits |
| --- | --- | --- | --- | --- | --- |
| A function, function expression, arrow, or method with a plain return annotation, `(n: number): number`, or `: infer _` | Plain; as a value, Effect where its return type is definitely an Effect (D511) | Plain; Run where its return type is definitely an Effect (D480) | Called; EK1001, EK2003, or EK4301 where its return type is definitely an Effect | The plain function, with its TypeScript signature | It is passed, unless its return type is definitely an Effect or may be one: EK4301 (D511, D512) |
| One without a return annotation, or with an Effect contract, `(n: number): number!!`, whatever its body | Effect | Run, through a plain variant where the compiler gives it one (Chapter 15, D421) | EK1001, EK2003, or EK4301, plain variant or not | A function returning a cold `Effect`, with its Effect signature | EK4301 |
| A class's unannotated protocol method, or one implementing a plain member its class declares (D397) | Plain, checked as a plain function | Plain | Called | The plain method | It is passed |
| A function literal at a destination, an object literal's method or function-literal field included | The destination's (rule F): plain, Effect, or a program; plain at a protocol key (D484) | As its form's row | As its form's row | As its form's row | Plain where the destination gives the plain form; an Effect-annotated literal there is EK4301 |
| A function literal with no destination, a class field's function-literal initializer with no declared type included, `double = (n: number) => n * 2` | Effect | Run | EK1001, EK2003, or EK4301 | A function returning a cold `Effect` | EK4301 |

**One form, typed as it is** [Rule] (D500). A function's form is its type's, so it goes wherever the value goes, as TypeScript's types do: `const twin = double`, `let g = double`, `{ double }`, an element, a method of a returned object, and an import, through any alias, re-export, namespace import, or default export, hold `double` in the form it was declared with, from source and from declarations alike. A holder follows TypeScript: with `double` and `logged` both unannotated, `let g = double; g = logged; g(5)` runs `logged`, since both are Effect functions of one type, and with `double(n: number): number`, `g = logged` is TypeScript's TS2322, since `Effect<number>` is not `number`. An object or array holds its functions in their declared forms, so passing `const fs = [tick, tick]` where `ReadonlyArray<() => unknown>` is expected is EK4301 when `tick` is an Effect function, and calls `tick` twice when `tick(): void` is plain (Chapter 14).

```ts es
export function double(n: number): number { return n * 2 }   // plain: (n: number) => number to every caller
let g = double
export const four = g(2)                                       // 4: a plain call at a module's top level
export const api = { double, triple(n: number): number { return n * 3 } }
export const six = api.triple(2)                               // 6
export const doubled = [1, 2].map(api.double)                  // [2, 4]
export function makeApi(): infer _ { return { half(n: number): number { return n / 2 } } }
export const one = makeApi().half(2)                           // 1, from source and from declarations
export function third(n: number) { return n / 3 }              // no annotation: an Effect function, number!!
export const thirds = [3, 6].map(third)                        // EK4301; the quick fix writes third(n: number): number
```

A call of an Effect function runs, whatever the callee's body does, so plain code may not make it (rule R), and it counts toward an Effect function's plain variant only through the callee's own variant (Chapter 15). Producers are Chapter 8's.

#### Evaluation order and binding time

**Rule E.** Every expression is evaluated in JavaScript's order, each operand once, and a call that runs runs at its place in that order (D326). Precisely:

- **E1. Operands.** Operands are evaluated left to right, each exactly once, as ECMAScript evaluates them. A call evaluates its callee reference, receiver then member, before its arguments, and keeps the receiver as `this` (ECMAScript EvaluateCall, 13.3.6.1). A property read, a getter included, happens once per access written. An assignment evaluates its target reference before its right side; a compound assignment reads its target once and writes it once. A spread argument iterates once. A tagged template evaluates its tag reference, then its substitutions left to right, then calls the tag with the site's one template object (D267).
- **E2. Calls that run.** A call that runs runs after its callee and all its arguments are evaluated, and before anything to its right is evaluated. A pause inside it keeps every value already evaluated: no operand is evaluated again when the fiber resumes. If it fails, nothing to its right is evaluated, as after a `throw`.
- **E3. Service and control calls.** `S.m(args)` looks the service up, then reads the member, then evaluates the arguments, then calls, as `S().m(args)` does under E1. A missing service fails at the lookup, before any argument is evaluated.
- **E4. Short circuits.** In `a || b`, `a && b`, `a ?? b`, and `c ? x : y`, the left operand or the condition is evaluated first, a call that runs included, and its value, the success value and never a program, is tested. The right operand or the branch not chosen is not evaluated.
- **E5. Optional chains.** In `o?.m(args)`, `f?.(args)`, and `o?.[k]`, when the value before `?.` is `null` or `undefined`, the whole chain is `undefined` and nothing to its right is evaluated: no member read, no argument, no call. Otherwise the chain continues under E1 to E3, and `f?.(args)` runs when `f`'s declared return type is definitely an Effect (D321, D480, D500).
- **E6. Pipes.** `x |> body` evaluates `x` once, before anything in the body, and `%` is its value; then the body is evaluated under E1. A name the body reads is read after `x` is evaluated, so the body sees what evaluating `x` changed. A function in the body that reads `%` keeps the value of the evaluation that created it (D325).
- **E7. Forms with operands.** A keyword form evaluates its own operands in the order written, before it starts any program. `for concurrent(n) (const x of xs)` evaluates `n`, then `xs`, then iterates `xs` once. `provide A, B { … }` evaluates `A`, then `B`. `wire(a(), b())` evaluates `a()`, then `b()`, then builds the layers in dependency order. `join e`, and an await operation whose operand is not an array or object literal, evaluate `e` once and read each element or own enumerable property once, in ECMAScript's order, and use that one reading both to wait and to interrupt; an await operation reads an iterable operand when it starts, on each run. An await operation whose operand is an array or object literal evaluates its computed keys and spread elements once, in source order, when it starts, and each element is a program (rule D, D377). Each element runs as a program on its own fiber, and its success value is its result (D394). A hatch evaluates its function, then its mapper, then its inputs (Chapter 10).
- **E8. Programs.** Evaluating a form of rule D evaluates nothing inside it. Each run of the program evaluates its body from the start under E1 to E7. Locals declared inside are fresh on each run. A binding captured from outside is read when the body reads it, so a run sees the binding's current value, not a copy taken when the program was built.
- **E9. Call time and run time.** For a VibeLang caller, call time and run time are one moment: a call that runs evaluates its arguments, then runs the callee's program at once. They are two moments for a TypeScript caller, which receives the program (Chapter 10), and for a program value run more than once. Bound once per call: the receiver and the argument values. Bound once per run: the parameters, from those argument values, with default values evaluated, destructuring and rest parameters performed, and a fresh `arguments` object; then the body runs.
- **E10. Coldness.** Building a program, by rule D or by calling a VibeLang function from TypeScript, runs none of its work: no statement of its body, no parameter default, no getter its body reads. Coldness does not promise sameness: each run does the work again, and work outside the language, such as a Promise already started that the program captured or a memoized `Effect.cached` value, keeps its own behavior. Fresh frames are not fresh resources.
- **E11. Equivalence.** Every compiled form of a program, optimized or not, produces the observations of the frame lowering in Chapter 26: the same success value; the same Exit, with the same reasons in the same order; the same calls, getter reads, and side effects, in the same order and number; the same bindings and lexical context; and the same resource and fiber lifetimes. This binds the plain path (Chapter 15), single-result bodies (D274), JavaScript's own `for...of` (D404), operand hoisting, pipe substitution, and every automatic fix that claims to keep a program's meaning (Chapter 28). An optimization that cannot establish this for a program is not applied to it.

When each part of a program is evaluated:

| Expression | Evaluated or run | How often |
| --- | --- | --- |
| An argument | Before the call, where the call stands | Once per evaluation of the call |
| A function body, its parameter defaults and destructuring | When its program runs; for a VibeLang caller, at the call | Once per run |
| A function literal's body, a block param, `fork`'s operand, an await operation's element | When the program runs: `fork`'s and the await elements' on their own fibers | Once per run |
| `x catch y` | `x` where the expression stands, inside the catch; `y` only after an expected failure | Once per evaluation |
| The service lookup in `S.m(args)` | At the call, before its arguments | Once per call |
| A service read in a layer's body | When the layer is built (Chapter 4) | Once per build |
| A hatch's function, or its single expression | When the hatch runs, after its mapper and inputs | Once per run of the hatch |
| A pipe's left side | Before its body | Once per evaluation of the pipe |
| `using x = e`'s initializer | Where the declaration stands, with the interruptibility in force there; the release is registered as it gives its value, with nothing between (Chapter 6, D490) | Once per evaluation of the declaration |
| `using`'s disposal method | When the resource is registered, and called with the resource as `this`, as ECMAScript's explicit resource management does | Once |
| A module's top level, plain calls included | When the module is first imported | Once |
| A class field initializer, a constructor, an accessor, a static block | As JavaScript runs them, as plain code (D282) | As JavaScript does |

ECMAScript's evaluation order and Kotlin's suspending calls are the prior art: the operands come first, the suspension point is the call, and only a lambda delays.

#### Lexical context

**Rule L.** Every lowering keeps JavaScript's meaning of `this`, `arguments`, `new.target`, `super`, private names (`#x`), and a named function expression's binding of its own name (D327). Precisely:

- **L1. Source activations.** A function written in the source keeps its own activation: an ordinary function or method has its own `this`, `arguments`, `new.target`, and home object for `super`; an arrow function has none and reads its enclosing function's, as ECMAScript defines them (10.2). A function the compiler generates, such as a generator frame, a region closure, a thunk, the arrow that a `do` or `throw` expression becomes, a handler clause's body, a producer body, a pipe temporary, or a plain-JavaScript variant, is not a source activation: each of these names in it means what it means in the source function that contains it.
- **L2. Self reference.** A named function expression's name refers to that function inside it, whatever the generated function is called, and a call of it is a call of the source function.
- **L3. `super`.** `super.m()`, `super.x`, `super[k]`, `super.x = v`, `super.x += v`, and `super[k]++` read and write as JavaScript does, with the home object and receiver of the source method, and a computed key evaluated once (E1).
- **L4. Through pauses and runs.** These bindings keep their identity through a pause and on every run: the receiver bound at the call is `this` in every run, and `arguments` is the run's own activation object (E9).
- **L5. Blocks that are expressions.** A `do { }` expression is a block evaluated where it stands. A `break` or `continue` that would leave it, and a `var` declaration inside it, are EK1019, since its lowering cannot carry them out of the block; a `return` inside it is TS1108 (D187).
- **L6. Constructors.** A function declared in a `.vibe` file is not a constructor; `new` on one is EK1020. A class is the form that constructs, and its constructor runs as plain JavaScript (D282).
- **L7. No silent change.** A form whose lowering cannot keep one of these meanings is a compile error that names it.

TypeScript's own downlevel emit for generators and async functions keeps the same bindings with `_this`, `_arguments`, `_newTarget`, and `_super` temporaries.

#### Names

**Rule H.** Every name the compiler introduces is fresh, every source name keeps its binding, and every feature is recognized by the symbol a name resolves to, never by its spelling (D328). Precisely:

- **H1. Fresh names.** Every binding the compiler introduces, such as a temporary, a generated function, a plain-JavaScript variant, a region closure, a pattern's capture, a service's generated base class, or an alias for an import, is distinct from every source binding in every scope where it is visible, and from every name the source there can reference. The names in this document's generated listings, such as `double$direct` and `$match1`, are illustrative.
- **H2. Fixed references.** A source identifier keeps the binding it resolves to in the source, wherever a lowering moves it. A reference the compiler writes to a runtime function or an Effect function goes through an import binding that the compiler owns, so no source declaration can shadow it or be captured by it.
- **H3. Nothing reserved.** No identifier that TypeScript allows is reserved by VibeLang's output: a local named `runtime`, `Effect_1`, `answer$direct`, `$match1`, `scope`, `SyntaxError`, or `Users_base` behaves like any other name. A name that a declaration publishes on purpose, such as a data type's variant, is diagnosed when it collides (EK2124); it never captures.
- **H4. Recognition by symbol.** A rule that gives a name a special meaning applies only when the name resolves, through import aliases and re-exports, to the declaration the rule names. This covers runners (D38, D135), hatches (D148), `wire` (D27, D363), the prelude's functions, the built-in matchers such as `Option.Some` and `Number` (D208), the data-type method table (D152), a module's same-named export (D311), a function's trusted contract, and every exception list a diagnostic uses. A local declaration with the same spelling is an ordinary binding without that meaning; an alias of the declaration has all of it, except that the bindings of `fork`, `join`, and the hatches cannot be renamed or stored (EK4410, D432): `fork`'s and a hatch's first operand is deferred (rule D), and `join`'s is evaluated once and joined (E7), by syntax only those spellings carry (D462).
- **H5. Keywords.** `fork e`, `join e`, `await.all`, `await.allSettled`, `await.race`, `await.any`, `provide L { }`, `x catch y`, `do { }`, `match`, `is`, `using`, `for concurrent`, and the mask blocks are syntax: no binding changes the forms written without parentheses. `fork` and `join` are contextual keywords, and only their parenthesized spelling follows a binding (D391). `fork(x)` and `join(x)` always parse as TypeScript parses a call of an identifier, so a member access, an element access, or a call after the `)` applies to the value of the whole form, as after any call: `fork(work()).join()` forks `work()` and joins the fiber (D452). What the form means follows the binding: where `fork` or `join` resolves to the prelude's own, it is the keyword, `fork`'s one operand deferred by syntax (rule D) and `join`'s evaluated once (E7) (D462); where it resolves to a binding the program declares or imports, it is an ordinary call of that binding. The parse is the same either way, so the grammar never depends on a binding. The prelude's own `fork` and `join` are reached only through those spellings: an import that renames either, a member of a namespace import of the runtime, such as `R.fork(x)`, and any other reference to either, such as `const spawn = fork`, is EK4410, as a renamed or stored hatch is, so no call spelled otherwise defers its operand (D432, D452). The await operations take a parenthesized operand the same way: `await.all([a(), b()])` is a call in shape, so `await.all([a(), b()]).length` is the number of results, and the elements of its array or object literal operand are deferred, as without the parentheses (rule D, D462); `await` cannot be a binding.
- **H6. Declarations.** Declaration files follow H1 and H2: an import that a `.d.ts` adds for a prelude type uses a fresh alias (D123), and no generated declaration collides with an export.
- **H7. Renaming.** Renaming a source binding consistently, to any name TypeScript allows there, never changes what a program does. The conformance suite renames the locals of its cases to the names the compiler generates and to the runtime's export names, and compares the results.

Hygienic macro expansion (Kohlbecker and others, 1986; R7RS 4.3), Racket's sets of scopes, and TypeScript's own `createUniqueName` are the prior art; ECMAScript's ResolveBinding is the standard that H4 follows.

#### Where programs start

A call never starts a fiber; a program starts only when a **runner** receives it. The compiler recognizes runners by their resolved symbols (rule H4): `Effect.runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback`, and their `*With` forms; `ManagedRuntime`'s `run*` methods; `NodeRuntime.runMain` and `BunRuntime.runMain`; and `@effect/vitest`'s `it.effect`, `it.live`, their `.each` and `.prop` forms, and `layer(…)`.

A program's entry is an exported `main`; its file names its platform with an import, and the entry provides that platform's services (D135, D312):

```ts es
// main.vibe
import "vibelang/platform/node"

export function main() {
  const name = Effect.provide(() => welcome("42"), AppLive)
  log(`welcomed ${name}`)
}
```

When the host starts this module, its entry statement runs `main` with Node's runner and the platform's services; importing the module runs nothing. A TypeScript entry file works too, because `main()` returns an ordinary cold `Effect` there:

```ts ts
// run.ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { main } from "./main.js"

NodeRuntime.runMain(main())
```

A module that exports a function declaration named `main` with no parameters gets an entry statement, unless it already calls a runner at its top level (D135). An exported `const` or `let` named `main`, even one that holds a function, `export const main = () => …`, is not an entry point: the module starts nothing, and the compiler reports `EK4843`, a warning, that the binding is no entry, whose fix declares `export function main()` (D502, D517). The suppression test is rule H4's: a top-level call whose callee resolves to a runner's declaration, never a call that merely shares a runner's name, such as `helper.runSync(1)` on an object of the program's own. The entry statement uses `runtime.$entry` to start `main` only when the host starts this module, so importing it starts nothing; the helper checks the started file's exported `main` in bundles and CommonJS output, so an imported module's `main` does not start with the entry module's. The runner is `NodeRuntime.runMain` when `@effect/platform-node` resolves from the module, and the runtime's `$runMain` otherwise. A `main` with a plain return annotation runs through `Effect.sync` (D500, D502). An explicit top-level runner supplies its own layers and options and replaces the generated entry. Without a platform import, the entry provides no layer, and EK3205 names the services `main` needs that nothing provides. Whether a file gets an entry statement, what it provides, and whether EK3205 is reported depend on that file alone: no other file's imports enter any of the three (D387).

A module's top level is inside no program. A call there may build values, such as `Layer.effect(…)`, `wire(…)`, `Config.Port(…)`, or `Schedule.exponential(…)`, and plain calls run there, a call of a plain function among them (D445), but any other call that runs a program is EK1001:

```ts es
// config.vibe
export const config = loadConfig()
```

```text
error EK1001: loadConfig() runs a program, but a module's top level is not inside one.
  config.vibe:2:23   export const config = loadConfig()
  Hold the program as a function, and call it inside one: const config = () => loadConfig()
  Run it inside a function that a program runs, such as main.
  Or provide the value as a service with a Layer.
```

A runner is called only where no fiber runs the code: a module's top level, or a plain callback that such a place passes to a TypeScript function, such as a `describe` body or a web framework's route handler. In code a fiber runs, a runner would start a new root with an empty Context and no handlers, outside the caller's structured concurrency:

```ts es
function refreshAll(ids: ReadonlyArray<string>) {
  for (const id of ids) Effect.runFork(() => refresh(id))
}
```

```text
error EK1005: Effect.runFork starts a new root fiber, but refreshAll already runs on one.
  refresh.vibe:2:25   for (const id of ids) Effect.runFork(() => refresh(id))
  To outlive refreshAll as a root would:   detach(() => refresh(id))
  To wait for every one:                   forEach(ids, (id) => refresh(id), { concurrency: "unbounded" })
```

Tests in `.vibe` use `it.effect`. A test that must `await` a Promise stays in a `.ts` file.

#### Blocks as values

A final `match` supplies the selected arm’s value, as in `do { match (0) { default: 2; } }`, whose value is `2`. This also applies when the `match` is in a final block or an `if` branch.

A `do { }` expression (D187, the TC39 [do expressions](https://github.com/tc39/proposal-do-expressions) proposal) has the value of its last statement. It is evaluated where it stands, like any expression, and builds no program. To pass a block as a program, write a function literal or a block param. An await operation's element is already a program, so a `do` there gives the element statements of its own:

```ts
function cached(): string!! {
  sleep("1 millis")
  return "cached"
}

function fetched(): string!! {
  sleep("1 second")
  return "fetched"
}

function firstSuccess() {
  return race(() => { const value = cached(); return value.toUpperCase() }, () => fetched())
}

function firstToFinish() {
  return await.race [do { const value = cached(); value.toUpperCase() }, fetched()]
}
```

#### Blocks after calls

A block on the same line after a call or a name is a program passed to that call (D188, the TC39 [block params](https://github.com/samuelgoto/proposal-block-params) proposal). It is always the last argument (D376): `f(args) { block }` is `f(args, () => { block })`, and `f { block }` is `f(() => { block })`. The block is a function body, so a value needs `return`. Its place never depends on the callee, and the written arguments are evaluated left to right before the call (E1):

```ts
function work(): string!! {
  sleep("1 millis")
  return "done"
}

it.effect("work finishes") {                 // it.effect("work finishes", () => { … })
  assert.strictEqual(work(), "done")
}
```

An Effect dual takes its program first, `withSpan(self, name)`, or returns a function that takes it, `withSpan(name)(self)`, and a curried combinator such as a semaphore's `withPermits(1)` returns such a function too, so a block after one of them, which goes last, fits no signature. That call fails with TypeScript's own type error, and a note names the parameter that takes the program and gives the spelling with an arrow in its place: `withSpan(() => { … }, "load")`, `semaphore.withPermits(1)(() => { … })`. A type decides only whether the call is rejected, never where the block goes; a migrated call whose appended form would still type-check is EK1023 (D382). Several combinators around one program nest arrows, or name each step:

```ts es
function loadUser(id: string) {
  const attempt = () => fetchUser(id)
  const retried = () => retry(attempt, { times: 3 })
  const bounded = () => timeout(retried, "2 seconds")
  return withSpan(bounded, "load-user")
}
```

`retry` runs `attempt` on each attempt, `timeout` bounds the retried work, and `withSpan` traces both.

A `{` on the line after a call or a name starts a block statement, as in JavaScript, not a block param. Where the statement before ends, with no `;`, in an identifier, a member access, or a call, as `return once` followed by `{ … }` on the next line, which would return the function and leave the block unreachable, the block is EK1022, a syntax error: join the lines to pass the block, or end the first line with `;` to keep a block statement.

A call with a block is a primary expression like any call: a member access, an element access, or another call may follow its closing brace (D273).

#### Precedence of VibeLang's forms

VibeLang's expression forms take these places in TypeScript's precedence, from the tightest [Rule]:

| Form | Binds | Decision |
| --- | --- | --- |
| `fork e`, `join e`, `await.all e`, `await.allSettled e`, `await.race e`, `await.any e` | As `await` binds its operand: `fork a().b` forks `a().b`. The operand starts on the keyword's line. A parenthesized form, `fork(e)`, `join(e)`, or `await.all(e)`, is a call in shape: what follows its `)` applies to its value | D166, D196, D225, D452 |
| `throw e` in an expression | Takes a unary expression, as in the proposal; a throw that is, or ends, a binary operator's left operand, a conditional's condition, or the operand of `as` or `satisfies` is EK1010 | D186 |
| `x is P` | At `instanceof`'s precedence | D211 |
| `x catch y`, `x catch (e) => h` | Looser than every binary operator, `??` and `\|\|` included; tighter than `? :`, assignment, arrow functions, and `\|>`; left-associative | D237 |
| `x \|> body` | Looser than every binary operator and `? :`, as an assignment is; left-associative; the body is a conditional expression | D154 |

A contract's `!` slots bind in types as Chapter 14's table says. Calls, `new`, member access, and every other operator keep TypeScript's precedence.

#### Where a type decides

A type rejects programs. In these places, and no others, a type also decides what a program does [Rule] (D413):

| Where | What the type decides | What it never decides |
| --- | --- | --- |
| Whether a call runs (rule R, D321, D458, D480) | A call runs when the declared return type of the signature it resolves to is definitely an Effect, a plain function's plain signature included, as a call of a Kotlin `suspend` function suspends. This is deliberate, and it is the only place a type makes a call run: changing a callee's declared return type from data, such as an `Exit`, a type parameter, or a union with a non-Effect member, to an Effect makes its calls run | When or how often the call's operands are evaluated; and which construct declares a type parameter that the return type names: a class's, an interface's, and an alias's are read alike, as TypeScript instantiates them for the call (D458, D486), and the callee's type is read as TypeScript writes it, so a declaration file gives the same answer (D491). A type that extends `Effect` is data whatever construct spells it (D393) |
| A function's form (rule F, D324, D421, D500) | Whether a function literal is a plain function, an Effect function, or a program, from the declared type at its destination, unless its return annotation writes the form; a function value's form, from its type as TypeScript writes it (D492); whether a function with no required parameters converts to a program; and which elements a spread in a literal at such a destination converts, from their static types (D423, D453). The destination's type comes from the overload TypeScript picks and, through inference, the call's own contextual type (D482, D494). So it decides what the receiver's call of the function does: a call of a plain function runs the body, and a call of an Effect function builds a program whose body runs only when the receiver runs it (D447); and so, for an unannotated literal whose body compiles in either form, the order of a library's overloads and the call's contextual type decide when its body runs (rule F's rough edge, D510) | That passing or converting the function runs anything: neither runs any of its body; and the function's body, which never decides its form |
| A method's form (Chapter 10, D397) | Whether an unannotated method that implements a member of a declared interface or base class is plain: it is, where that member, read by its declaration with its declaring type's own type parameters uninstantiated, is plain (D492) | The form of any other method, which its annotation or its name decides |
| A function's return annotation (D67, D385, D500) | Whether the function is plain or an Effect function, to VibeLang and TypeScript callers alike: a type that is not definitely an Effect, or `infer _`, makes it plain | Whether a call of it runs, which its declared return type decides, as any callee's does (rule R) |
| A method on an Effect data type (D152, D336) | Which module function `x.name(args)` calls, from the receiver's type, as an extension method | Evaluation order: the receiver first, then the arguments |
| A hatch's first argument that is not a function literal (Chapter 10, D503) | Whether the hatch calls it with the inputs, where its type is a function, and whether it waits for the call's promise, where that function's declared return type is a `Promise` | When it is evaluated: when the hatch runs, as every single expression is; and a function literal's waiting, which its `async` decides (D439) |
| An await operation's operand that is not a literal (Chapter 7, D394) | That each element is a program to run on its own fiber, from the operand's element type; any other element type is rejected | How often the operand is read: once per run of the operation |
| `using` (Chapter 6, D401, D490) | Whether `using x = e` may bind a value it cannot dispose: where `e`'s requirements include `Scope` it may, and adds no release, since the acquisitions in `e` own what they made; any other such value, which only a cast can produce, is a `TypeError` | Who releases a value it can dispose, and how many times: the acquisition's run-time record and the value decide that, and the answer is once; and when interruption reaches `e`, which is where it would reach `yield* e`, one program for every initializer (D490) |
| `wire` (Chapter 4, D363) | The order in which its layers are built, from their Layer types | The order in which its arguments are evaluated: source order |

Every other rule reads syntax, resolved symbols, or run-time values. A program that a type would make mean something else is rejected instead. Optimizations are not on this list: rule E11 makes each one unobservable, so a type that lets the compiler choose a faster form decides nothing a program can see.
