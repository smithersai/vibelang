### 15. Which functions compile to plain JavaScript

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

A function's form is written (Chapter 13, rule F, D500). A function with a plain return annotation, or `: infer _`, is a plain function: it compiles to one JavaScript function, which VibeLang and TypeScript callers alike call directly (D67). Every other function is an Effect function, which TypeScript sees as returning a cold `Effect`. An Effect function like `double` below should still cost what a JavaScript call costs where VibeLang code calls it, so the compiler gives it a plain variant for its calls whenever the difference is unobservable: the variant produces every observation the frame form does (Chapter 13, rule E11; D333). The variant is an optimization of those calls, never a form (D421).

```ts es
function double(n: number) {          // no annotation: an Effect function, number!!
  return n * 2
}

function area(w: number, h: number) {
  return double(w) * double(h) * Settings.scale()
}
```

```ts gen
function double$direct(n: number): number {                     // VibeLang calls in Effect code use this
  return n * 2
}
export const double = (n: number): Effect.Effect<number> =>     // TypeScript callers, and every value use, get this
  Effect.sync(() => double$direct(n))
double[$direct] = double$direct                                  // other files' calls reach the variant (D268)

export const area = Effect.fnUntraced(function* (w: number, h: number) {
  const left = double$direct(w) * double$direct(h)              // source order: before the service call
  const scale = yield* (yield* Settings).scale()                // a service call: may pause
  return left * scale
})
```

`double(3)` at a module's top level and `[1, 2].map(double)` are EK1001 and EK4301 all the same: `double` is an Effect function, and its variant is no form a destination receives. Written `function double(n: number): number`, it is a plain function, and both compile.

#### The rule

A function with a plain contract, from a plain return annotation (D67, D500) or the plain form a function literal's destination gives it (Chapter 13, rule F), is JavaScript because it never fails and needs nothing (D282). `throw` is a typed failure there as everywhere outside a hatch: one that can escape is EK2003 under an annotation and EK4301 for a callback, and the function may throw what its own `catch` handles. A trusted call's listed failures are typed failures there too (D399): one that can escape is EK2003 under an annotation and EK4301 for a callback, as a `throw` is, and a `catch` of the function's own receives it typed. A call of TypeScript code follows Chapter 10's rules here as in every function: a plain TypeScript function with no trusted contract is EK4401, so a plain annotation never opens a way around the trust boundary (D329). An exception no contract lists, from a trusted call or from a function value the function received, is a defect: it propagates unchanged and becomes `Die` where it reaches an effectful caller. Its `.d.ts` writes its TypeScript signature and nothing else; the compiler's manifest tells a declaration consumer that it is a plain VibeLang function (Chapter 27, D500). Running an Effect under a plain contract is EK2003.

For an Effect function, the compiler provides a plain `$direct` variant for its calls when all three hold. Its callers in Effect code call the variant; its form stays Effect, as its declaration says, and no destination receives the variant (D421).

1. **It performs no Effect operation at all.** Its body calls only plain functions, trusted built-ins, and trusted functions whose return type is not definitely an Effect, since a call of one that is runs the program it returns (D480), and Effect functions that get a variant themselves, through that variant; it calls no service, control operation, other Effect function, or boundary hatch such as `sync`. A call inside a function literal that the body only builds, such as the `() => syncInventory(store)` that Chapter 5's `makeSync` returns, belongs to that literal, not to the body (D456). Its control class is `pure` or `sync`.
2. **Its E is `never`.** A typed failure leaving the variant would cross JavaScript frames as an exception, and v0 bridges no exception across a call. A trusted function's listed exceptions are typed failures at its call, in Effect code and plain code alike (Chapter 26, D399). A plain function's own catch receives them as typed failures (D54, D282), and an exception from code with no contract passes through that catch and becomes a defect where it reaches an Effect caller. A function whose listed failures can escape has E other than `never`, so it gets no variant. Bridging across calls is experiment G15.
3. **Its contract, if it has one, writes E and R as `never`.** A caller sees the contract, not the body (Chapter 14), so `function answer(): number!Gone!Needed { return 1 }` is an Effect function whose callers can fail with `Gone` and need `Needed`, and EK2001 and EK2002 hold them to it. `number!!` keeps the variant, and a channel written `infer Name` counts what the body raises.

The test is "can it reach an Effect operation", not "are E and R empty": `Effect.sleep("1 second")` has E = R = `never`, and it pauses the fiber. So the compiler tracks a separate fact per function, its **control class**:

| Control class | Meaning | Examples | Plain JavaScript |
| --- | --- | --- | --- |
| `pure` | No observable effect; cannot pause | `double`, string formatting, `Math.max` | Yes |
| `sync` | Observable synchronous work; cannot pause | Mutating an object, `Map.prototype.set`, a trusted TypeScript function | Yes; the work's order and count are kept |
| `suspends` | May pause the fiber, or crosses an Effect boundary | `Effect.sleep`, `sync(…)`, any service method, any imported Effect | No |
| `captures` | May reach a handler (Chapter 9) | `Approval.approve`, `yield` in a producer | No |

`pure` is assigned only to VibeLang functions the compiler analyzed and to built-ins on the compiler's list; a trusted TypeScript function is `sync` at most. `pure` permits one thing beyond `sync`, inlining the body at a call, and never permits removing a call whose result is unused, reordering calls, or merging two calls into one.

#### Why this is safe

- **Nothing runs early when building an Effect.** For an Effect function with a variant, the TypeScript-facing form is `Effect.sync(() => …)`, never `Effect.succeed(double$direct(n))`. Building a program does no work, even work that looks free. A pure function can still throw a defect (`(undefined as any).x`), and that must happen when the program runs, not when it is built.
- **No point where another fiber could run disappears.** A plain call runs inside its caller's current step. Every Effect operation is such a point, including an `Effect.sync` body, so a function containing one gets no variant. Inlining a callee that performs no operation removes none.
- **Order is kept.** Generated code evaluates in source order (Chapter 13, rule E): in `area`, both `double` calls run before `Settings.scale()`, though only the service call can pause.
- **Public types follow written forms.** An Effect function exposes `(...) => Effect<A, E, R>` and, when the conditions above hold, gets a `$direct` shortcut for its calls, which crosses files only as `f[$direct]`, never as an export of its own and never in its declared type (D366). A plain function exposes `(...) => A` and emits one plain function (D67). Neither depends on the body, so a body that gains a log call changes no declaration and no caller: an unannotated function was an Effect function and stays one, and a plain-annotated function whose body gains one fails its own build with EK2003 (D500). Before the exporting module's body has attached `f[$direct]`, as in a module cycle, a call in Effect code runs the hoisted function's Effect form on the current fiber, as a call compiled without the variant does; a plain function is the hoisted function itself (Chapter 26).

#### Regions inside a plain function

A plain JavaScript function, a plain function or a variant, may contain `try`, `catch`, and `finally`. They mean what they mean in frame code, by Chapter 17's finalization rule and Exit rule (D340, D341), so the plain form changes no outcome (rule E11). Nothing inside can pause or be interrupted, but that alone does not make JavaScript's statements equal to the machine's: JavaScript's `finally` replaces a failure in flight when it fails itself, where the machine's `Final` adds the second failure to the first. So the lowering keeps JavaScript's statements with runtime helpers that keep the machine's rules. Its catch receives typed failures only (D54, D282): a throw becomes `throw $expected(e)`, a trusted call inside the try `$trustedPlain(…)`, and the catch starts with `e = $caught(e)`, which rethrows anything else, a defect. A `finally` that can fail runs inside the runtime's combining helper, which rethrows both failures together, so the Effect caller that receives them sees both reasons in order, as frame code reports them. Every accepted `throw` takes that path whatever its operand is, so a `Cause` held as `unknown` is thrown as the value it is and the catch receives that object, never its first reason; a statically `Cause`-typed operand is EK2140 before lowering, on this path and in frame code alike (Chapter 17, D406). `JSON.parse`'s shipped contract lists `SyntaxError`, so this catch receives it:

```ts es
function readPort(text: string) {
  try {
    return JSON.parse(text).port as number
  } catch (e) {                                // e: SyntaxError
    return 8080
  }
}
```

```ts gen
export function readPort$direct(text: string): number {
  try {
    return runtime.$trustedPlain(() => JSON.parse(text), [SyntaxError]).port as number
  } catch (e) {
    e = runtime.$caught(e)
    return 8080
  }
}
```

A `TypeError` from reading `.port` of `null` is a defect: `$caught` rethrows it, and it reaches the caller unchanged.

Any `using` declaration makes a function compile to frames, whether its initializer acquires an Effect resource or supplies an ordinary Disposable (D54, D342), so a `using` in a plain-annotated function is EK2003, and in a plain callback EK4301.

#### Methods that implement a plain-function member

```ts es
class Money implements Equal.Equal {
  constructor(readonly cents: number, readonly currency: string) {}

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Money && that.cents === this.cents && that.currency === this.currency
  }

  [Hash.symbol](): number {
    return Hash.combine(Hash.number(this.cents), Hash.string(this.currency))
  }
}
```

`Equal.Equal` declares `[Equal.symbol](that): boolean` and `Hash.Hash` declares `[Hash.symbol](): number`: plain functions that `Equal.equals` and `HashSet` call synchronously. A method implementing such a member is a plain method, checked as a plain function: it compiles to a plain JavaScript method, and a body that can pause, or let a `throw` or a listed failure escape, is EK4301 (D55, D397). VibeLang callers call it as a plain method, because its declared type is not an Effect. A method implementing a service member still compiles to an Effect function, because the service declares an `Effect` (D55).

#### Recursion

```ts es
function sumTo(n: number): number!! {
  return n === 0 ? 0 : n + sumTo(n - 1)
}

function walk(node: TreeNode): number!!Nodes {
  let total = node.size
  for (const child of Nodes.children(node)) total += walk(child)
  return total
}
```

`sumTo`'s body performs no Effect operation, so the compiler gives it a plain variant, and a VibeLang caller calls that plain JavaScript copy; its form stays Effect, as its contract says (D421). Plain variants are decided per strongly connected component of the call graph: a component's Effect functions get them when each would with calls inside the component counted as plain (D56, D421). A cycle of plain variants recurses as its frame form would (D10, D333): it starts on the JavaScript stack, for JavaScript's speed, and continues on heap frames past a depth budget, so `countdown(100000)`, mutually recursive `isEven(100000)`, and non-tail `sumTo(100000)` complete. How the compiler measures and shares that budget is the implementation's (`typescript/VIBELANG.md`) and changes no observation. A stack overflow that still happens, as a very large native frame can cause, is a `RangeError` defect.

A function with a plain return annotation, such as `function fact(n: number): number`, is an ordinary JavaScript function to its callers, and its own plain call cycles recurse as above: past the depth budget, the cycle continues on heap frames, which run to completion before the outermost call returns, since nothing in a plain function can pause (D412). An annotation therefore changes no observation, deep recursion included. Recursion through a synchronous callback, such as one `Array.prototype.forEach` calls, keeps JavaScript's stack and the host's limit, annotated or not: the callback's caller is foreign code, whose frame cannot move to the heap. `walk` calls a service, so it runs on heap frames and recurses without limit: 100,001 nested calls run without overflow (T6a).

#### Higher-order functions

An Effect function that calls a callback whose type returns an Effect compiles to frames in v0, because its control class depends on the callback's: `mapAll` in Chapter 16 runs a loop of frames whether its callback pauses or not. Compiling a plain-JavaScript copy per call site, or per class of callback, is a later optimization that changes no rule here. A callback parameter of a plain function type is plain, and a call of it is a plain call (D500): `function apply(f: (n: number) => number, n: number): number { return f(n) }` is a plain function, and with `double(n: number): number`, `apply(double, 3)` at a module's top level gives 6. Unannotated, `apply` is an Effect function, so the same call there is EK1001 (Chapter 16).
