### 14. Contracts and inference

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

#### What the compiler infers

A function with a plain return annotation, or `: infer _`, is a plain function and keeps its plain type (D67, D500, Chapter 15). Every other function, unannotated or with an Effect return annotation, gets a contract `Effect<A, E, R>`:

- **A** is its return type, inferred and widened as TypeScript infers one: `return "ok"` gives `string`.
- **E** is every error it `throw`s, plus every error its callees can fail with, plus the expected failures named by the trusted contracts it calls, minus what its `catch` blocks handle.
- **R** is every service and control operation it uses, plus its callees' requirements, minus what it provides or handles itself, plus `Scope` if a resource it acquires without `using` outlives it (Chapter 6). A `using` supplies the `Scope` its initializer requires, so that `Scope` is not in R: where the initializer's R holds a type parameter, R holds `Exclude<R, Scope>` (D490).

```ts es
function quoteCart(cartId: string) {
  const cart = Carts.load(cartId)              // E: CartNotFound   R: Carts
  if (cart.items.length === 0) throw new EmptyCart({ cartId })
  try {
    return Pricing.quote(cart)                 // E: PricingDown    R: Pricing
  } catch (e) {                                // e: PricingDown
    return estimate(cart)                      // a pure VibeLang helper
  }
}
// Quote!CartNotFound | EmptyCart!Carts | Pricing
```

`PricingDown` is caught, so it is not in E, but `Pricing` stays in R: catching an error does not remove the need for the service.

Precisely, E is the type of every expected failure a cause can hold. A defect beside expected failures makes them defects (D305), and `catch` recovers an expected failure beside an interruption, as `Effect.catch` does (D306), so no `Fail` reason escapes E. Chapter 17 states this guarantee, E bounds the `Fail` reasons that leave a function and nothing else (D355), and Chapter 26 lists every assumption the static guarantees rest on (D373).

#### Writing contracts

`.vibe` code writes `Effect<A, E, R>` as `A!E!R` (D127, D309) wherever a type can appear: return annotations, service members, parameters, and aliases. The parser expands it to `Effect.Effect<A, E, R>`.

| Written | Means |
| --- | --- |
| `User!NotFound!Db` | `Effect<User, NotFound, Db>` |
| `User!NotFound!` | `Effect<User, NotFound, never>` |
| `User!!Db` | `Effect<User, never, Db>` |
| `User!!` | `Effect<User, never, never>` |
| `User!NotFound` on a function with a body | `Effect<User, NotFound, infer R>`: R comes from the body |
| `User!NotFound` without a body | `Effect<User, NotFound, never>` |

An empty slot is `never`. Dependencies left out entirely are inferred on a function with a body and `never` everywhere else. Unions and intersections bind inside a slot, as do postfix `[]`, indexed access, and the prefix operators `keyof` and `typeof`, so `User!NotFound | Timeout!Db` fails with `NotFound | Timeout`. A slot's type starts on the same line as its `!`. An object type after a `!` needs parentheses: a `{` there starts the function's body, so `User!NotFound! { ... }` has no dependencies.

Function and conditional types keep their TypeScript structure within a slot. A `!` after a function's return type belongs to that return type. A conditional after a slot's type belongs to that slot. Parentheses delimit a slot that contains a function, conditional, or Effect type, or make the whole contract the subject of an outer type operator:

| Written | Parsed as |
| --- | --- |
| `A!E!R[]` | `Effect<A, E, R[]>` |
| `T["value"]!E!R["dep"]` | `Effect<T["value"], E, R["dep"]>` |
| `keyof T!E!typeof source` | `Effect<keyof T, E, typeof source>` |
| `A \| B!E1 \| E2!R` | `Effect<A \| B, E1 \| E2, R>` |
| `() => A!E!R` | `() => Effect<A, E, R>` |
| `A!E!R extends X ? Y : Z` | `Effect<A, E, R extends X ? Y : Z>` |
| `(A!E!R) extends X ? Y : Z` | `Effect<A, E, R> extends X ? Y : Z` |

Hovers and messages about `.vibe` code show contracts in the `!` form. Declaration files keep `Effect.Effect<A, E, R>`, so TypeScript callers are unaffected.

`Effect<A, E, R>` is accepted everywhere too, including `infer` slots (D57), and means what it means in TypeScript: a type argument left out is `never`, so `Effect<User>` is `User!!` and `Effect<User, NotFound>` is `User!NotFound!` (D308, D309). The two spellings name the same type wherever every channel is written, and this specification and the guides write the `!` form. They differ in one place, by a visible token: `User!NotFound`, with its last `!` and R left out, on a function with a body infers R, while `Effect<User, NotFound>` checks R as `never`, as does `User!NotFound!` (D335).

#### Checking a written contract

The compiler checks a body against its written contract:

```ts es
export function welcome(id: string): string!UserNotFound | MailError!Users {
  const user = Users.find(id)
  Mailer.send(user.email, "Welcome")
  return user.name
}
```

```text
error EK2002: welcome needs Mailer, but its contract says R = Users.
  welcome.vibe:3:3   Mailer.send(user.email, "Welcome")
  Provide Mailer inside welcome with provide layer { … }, or add it to the contract: Effect<string, UserNotFound | MailError, Users | Mailer>.
```

| Check | Rule | Diagnostic |
| --- | --- | --- |
| Success | The returned value must be assignable to A | TypeScript's |
| Errors | Every error that can escape must be in E; `A!!R` allows `catch` inside and rejects any error that escapes | EK2001 |
| Requirements | Every requirement that remains must be in R | EK2002 |
| Width | A contract may be wider than the body needs, never narrower | EK2001, EK2002 |

A call contributes its callee's contract as declared. Each channel a contract writes is what callers see, even when the body needs less, and each channel it leaves to inference is what the body needs (D73, D335). So callers of `function find(id: string): User!NotFound { … }` see E = `NotFound` and the body's R.

The contract has exactly three channels. Whether a function can pause is a separate fact the compiler tracks, its control class (Chapter 15).

#### Assignability

`A!E!R` is an alias of Effect's type and is covariant in all three channels. Widening A, E, or R preserves assignability. For example, `A!E1!R1` is assignable to `A!E1 | E2!R1 | R2`. A function's parameter types still follow TypeScript's function variance rules.

**An Effect never satisfies a plain function type** [Rule] (D430). TypeScript lets `() => Effect<void>` stand where `() => void` is expected, and a caller of the plain type would drop the program unrun. So in a `.vibe` file, wherever TypeScript checks one type against another, in an assignment, an argument, a return, an initializer, an `implements` clause, or an inferred or explicit type argument against its type parameter's constraint (D513), a call signature or method of the target whose return type is neither definitely an Effect nor a union with such a member, a plain function type, is not matched by a source signature or member whose form is Effect, or whose return type is a union with a definitely-Effect member (D512). The second clause keeps a function that may return a program from reaching a caller that drops it through a binding typed to accept both: with `tick` an Effect function, `const both: () => number | Effect<void> = tick` is accepted, since its target says it takes either, and `const erased: () => unknown = both` is EK4301, as `const erased: () => unknown = tick` is. Both sides read a member by its declaration, as the object's type carries it in a declaration file too: a member that a class, an interface, or a type alias declares is read with that declaration's own type parameters left uninstantiated, a VibeLang method by its form and any other by its declared return type read as rule R reads a call of it; any other member, such as an object literal's property, is read by its type as TypeScript writes it, and a source that is a function value, not a member, is read as rule F reads it, by its type as TypeScript writes it (D485, D492). That check is EK4301 (D485, D500). So a target member declared to return its container's type parameter, `get(): T` in `interface Source<T>`, is plain whatever `T` becomes, as a destination function type returning a type parameter is (rule F): `const logged: Source<number!!> = { get() { log("read"); return 1 } }` is EK4301, since a caller of `{ get(): unknown }` that later received `logged` would drop its work, and `get() { return job }`, a plain method that returns the program `job`, is accepted. An implementation of such an interface at an Effect type argument is therefore a plain method that returns a program: for `interface Repo<T> { get(id: string): T }` at `Repo<User!NotFound>`, write `get(id: string): infer _ { const job: User!NotFound = () => load(id); return job }`, whose literal converts to a program at the declared `const` (rule D), since `infer _` is the one spelling of a plain function that returns an Effect, while an unannotated `get(id) { return load(id) }` is an Effect method, EK4301 (D518). The check asks what the member is, which its declaration says; rule R asks what a call of it gives, which the instance's type arguments say. A member whose declared return type is its container's type parameter, as `get(): T` in `Box<T>`, returns what its container holds, and a caller of a plain type receives that value, as TypeScript's caller does, so `Box<Effect<number>>` is accepted as `{ get(): unknown }`, as `Getter<unknown>`, and as `Box<unknown>` alike, and `Effect<number>[]` as `ReadonlyArray<unknown>`, though `new Box(program).get()` runs where it is written (D458). Since the target side reads the same declaration, only a plain method reaches such a member: what `get` returns is what the container holds (D492). Against overloads, the check is part of whether a candidate accepts an argument, in rule F's first step: a candidate whose parameter type has such a plain member does not accept the argument, TypeScript's order picks among the candidates that do, and EK4301 is reported only when none does (D453). Rule F gives a function literal its destination's form first; this rule checks the rest: a function value, an object's methods, an array's elements, and a class's instances. An object or array holds its functions in the forms they were declared with (D500), so with `const api = { reset() { count++ } }`, whose method has no contextual type and is an Effect method (rule F), passing `api` where `{ reset(): void }` is expected is EK4301, and so is passing `const fs = [tick, tick]` where `ReadonlyArray<() => unknown>` is expected when `tick` is an Effect function, since a caller of either type would drop the work. The quick fix writes a plain return annotation on the function, `reset(): void` or `tick(): void`, or the literal at the destination, where rule F gives its method the plain form. A class meets a plain member only through a plain method: one with a plain annotation, a protocol method, or one that implements that member of an interface or base class its class declares, the member read by its declaration (D397, D492), so a `.vibe` subclass of `Box<number!!>` whose `get` logs is EK4301. An object literal's method is a function at its field's destination (rule F), so one written where a plain member is expected takes the plain form there, and a body that runs an Effect is EK4301.

```ts es
interface Resettable { reset(): void }

class Counter {
  n = 5
  reset() { this.n = 0 }                  // unannotated: an Effect method (D397)
}

const target: Resettable = new Counter()  // EK4301: a caller of reset() would drop its program
```

Write `class Counter implements Resettable`, which makes `reset` plain, or annotate it, `reset(): void`. The same check rejects passing `[new Counter()]` to a TypeScript function that takes `Array<{ reset(): void }>`.

A service's name, as a type, is its identifier: the instance type of the `Context.Service` class Effect TypeScript writes, which carries the service's key as a literal type (Chapter 4, D501). A type is assignable to the identifier only if it carries that key, so two services with the same members are different types, and no structural type, `{ get(): number!! }` included, stands for either. An implementation has the service's shape, `Users.Shape`, Effect's `Context.Service.Shape<typeof Users>`, and is checked against it. For `service Name: Shape`, `Name` is the identifier and `Shape` the implementation's type.

An `error` declaration creates a runtime class with a literal `_tag` and readonly fields, and declares what Effect TypeScript declares for that class (D501), so its type is structural, as a `Data.TaggedError` class's is: another package's error class with the same tag and fields is assignable to it, as in Effect TypeScript, and only their constructors and `instanceof` tell them apart at run time, which no type shows. So a class arm over a tagged class tests the tag its type declares, as Effect's `catchTag` does, and removes from the subject every case whose `_tag` type that tag set covers; a value of a same-shaped class of another declaration has that tag and takes that arm, as it takes `catchTag`'s (Chapter 3, D515). A subclass is assignable to its base, as any subclass is. Class patterns narrow as TypeScript narrows the tag and keep their run-time test in every arm of every match (D405). Cases `match-class-patterns` and `match-class-patterns.fail` cover class matching.

A `data` declaration names Effect's `Data.TaggedEnum` union (D307). Its variants are structural types determined by their `_tag` and readonly fields. Matching variant shapes from different packages are assignable, with no brand added by the data declaration's name. A generic data type follows TypeScript's variance for each type parameter's use in its fields.

#### Declarations without bodies

Service members, control operations, `declare function`, and fields typed as functions have no body to infer from, so each states its contract without `infer`. A bare return type on a service or control method is EK2101, never a silent `A!!`. Either spelling states a contract there, and a channel left out is `never`: `find(id: string): User!NotFound` and `find(id: string): Effect<User, NotFound>` can fail with `NotFound` and need nothing (D93, D308, D309):

```ts es
service Rates {
  lookup(currency: string): number
}
```

```text
error EK2101: Rates.lookup has no body to infer from, so its contract must be written as an Effect type.
  rates.vibe:2:38   abstract lookup(currency: string): number
  Write number!Errors!Dependencies; use number!! if it cannot fail and needs nothing.
```

A service's value members are not calls, so they take any type: `abstract readonly baseUrl: string`. A function type in a parameter is no exception: it means what TypeScript means, and a callback that may fail or need services writes its channels as type parameters (Chapter 16, D500).

#### Partial annotations

In the return annotation of a function with a body, a channel written `infer Name` comes from the body; every other channel is checked (D57). The `!` form leaves dependencies to the body when it leaves them out, `User!NotFound`; `Effect<…>` checks a channel it leaves out as `never`, as TypeScript's defaults make it (D308, D309).

```ts es
function find(id: string): Effect<User, infer E, never> {
  return Effect.fail(new UserNotFound({ id }))
}
// Checks A = User and R = never; infers E = UserNotFound.

function load(id: string): Effect<User, never, infer R> {
  return Effect.orDie(() => Users.find(id))
}
// Checks A = User and E = never; infers R = Users.

function plan(id: string): Effect<infer A, UserNotFound, Users> {
  return Users.find(id).name
}
// Infers A = string; checks E = UserNotFound and R = Users.

function greeting(id: string): Effect<string, infer E, infer R> {
  return `Hello, ${Users.find(id).name}`
}
// Checks A = string; infers E = UserNotFound and R = Users.

function inferred(id: string): Effect<infer _, infer _, infer _> {
  return Users.find(id)
}
// User!UserNotFound!Users, as with no annotation.
```

The name after `infer` is documentation only, not in scope in any channel or in the body. `infer _` is allowed in any number of channels. A name other than `_` written in two channels of one contract, as in `Effect<infer Value, infer Value, never>`, draws EK2129, a warning: the channels are not connected, as TypeScript's repeated `infer` would connect them, so the spelling reads as a promise it does not keep, though the contract means what it means with distinct names (D414, D504).

A channel left out of `Effect<…>` is checked, never inferred: `Effect<User>` promises, as `User!!` does, that the function cannot fail and needs nothing, so a body that returns `Users.find(id)` under it is EK2001 for `UserNotFound` and EK2002 for `Users`. To check only A, write `Effect<User, infer E, infer R>`. A plain return annotation such as `: User` is EK2003 when a function's or a method's body runs an Effect, and when any function's throw or a trusted call's listed failure can escape, since a plain function never fails (D74, D282, D399); a plain-annotated function compiles to one plain function (D67). A method's annotation is its type in its declaration file and in every interface its class satisfies, so an Effect behind it would reach those callers unrun. A method implementing a plain-function member of a JavaScript protocol, such as `[Equal.symbol]`, is checked against that member instead, as EK4301 (D55). An unannotated class method's declaration determines whether it lowers to an Effect, never its body: it is plain where it implements a plain member or is a protocol method, and an Effect method otherwise (Chapter 10, D397); an object literal's method takes its field's destination's form, as a function literal does, and one at a protocol key the plain form (D484, D500).

`infer`, and the `!` form's inferred dependencies, apply only in the return annotation of a VibeLang function with a body. Everywhere else, in parameter types, type aliases, service members, and `.ts` files, an Effect type means what TypeScript means by it, `never` defaults included. A function type in a parameter means what TypeScript means (Chapter 16, D500).

#### Recursion

A recursive Effect function's E and R come from a fixpoint over its strongly connected component of the call graph. Cached catch-variable or return types can require a written contract before those channels are known (EK2102, D71):

```ts es
function totalSize(path: string) {
  const entry = Files.stat(path)
  if (!entry.isDirectory) return entry.size
  let total = 0
  for (const child of Files.list(path)) total += totalSize(`${path}/${child}`)
  return total
}
// number!IOError!Files
```

TypeScript cannot compute this alone: to it, the generated recursive function is an implicit `any` (TS7022). The compiler computes the fixpoint itself, inside the component only (D52): it checks the component's bodies, then rechecks only those bodies with the E and R found so far, until E and R stop growing. Rows only grow and are finite, so the iteration ends, and no function outside the component is checked twice. The recheck matters for mutual recursion:

```ts es
error Locked { path: string }

function visitDir(path: string) {
  for (const child of Files.list(path)) visitEntry(`${path}/${child}`)
}

function visitEntry(path: string) {
  if (path.endsWith(".lock")) throw new Locked({ path })
  if (Files.stat(path).isDirectory) visitDir(path)
}
// both: void!IOError | Locked!Files
```

Checked once in source order, `visitDir` meets `visitEntry` before `visitEntry` has a contract and misses `Locked`; the recheck adds it. The prototype compiler reaches the same contracts by re-checking the whole program (`prototype/esc/FINDINGS.md`). The single-pass experiment found this case, in its `isEven` and `isOdd` probe, the only one needing a second check (`prototype/single-pass/RESULTS.md`). A follows TypeScript's rule: when A depends on the function's own result, the contract must be written (EK2102).

A contract may write A and leave E or R to the fixpoint, as `number!Neg` leaves R (D57). A call of the function in its own body runs, as every call does (Chapter 13), so it has type A while the fixpoint runs:

```ts es
function fact(n: number): number!Neg {
  if (n < 0) throw new Neg({ n })
  if (n <= 1) return 1
  return n * fact(n - 1)
}
// number!Neg!never
```

Where the function is generic, TypeScript needs the contract before the fixpoint has its channels, so the contract must write every channel; EK2102's note gives it, such as `number!Neg!Audit`.

An unannotated recursive function is an Effect function, whatever its body does (D500), so EK2102 applies to it where its A depends on its own result, as for any Effect function; a plain annotation makes it plain, and plain recursion keeps TypeScript's TS7023 when its return type depends on itself, which the annotation already fixes (D72, D518). The current checker also needs contracts in some cached-type cycles that the fixpoint model alone would solve. A cycle through a callback uses the checker's single type for that call, and generic-call inference does not fill `infer` channels in a lambda (F3's known gaps).
