### 10. Working with TypeScript

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

VibeLang uses the TypeScript compiler and shares its types, modules, and Effect. A project mixes `.ts` and `.vibe` files freely: existing Effect code stays in TypeScript, and new code goes in either.

#### Using TypeScript Effect code from VibeLang

A TypeScript function whose declared return type is an `Effect` is called like any VibeLang function: the call runs it, and its A, E, and R join the caller's contract unchanged (Chapter 13).

```ts ts
// users-repo.ts
export const findUser = Effect.fn("findUser")(function* (id: string) {
  const db = yield* Database
  const rows = yield* db.query("select * from users where id = $1", [id])
  if (rows.length === 0) return yield* new UserNotFound({ id })
  return toUser(rows[0])
})
// (id: string) => Effect<User, UserNotFound | DbError, Database>
```

```ts es
// page.vibe
import { findUser } from "./users-repo.ts"

export function title(id: string) {
  return findUser(id).name.toUpperCase()
}
// string!UserNotFound | DbError!Database
```

Generic, overloaded, and aliased TypeScript functions keep their signatures, and a function that a generic call returned, such as `Effect.fn("load")(body, Effect.scoped)`'s, runs as TypeScript shows its type, as does any call TypeScript types as an Effect, except where the Effect is a type parameter the callee itself declares, as `identity`'s is (Chapter 13, D449, D458). TypeScript services, `Context.Service` classes or values, are used exactly like abstract service classes: `Database.query(…)` works on either. The one exception is a TypeScript function whose R contains a control operation (EK4202, Chapter 9).

#### Producers and JavaScript generators

Existing `Effect.gen` and `Effect.fn` code keeps working in `.ts` files, and VibeLang calls it as above. It cannot move into a `.vibe` file unchanged, because there `function*` declares a producer (Chapter 8, D370):

```ts es
const findName = (id: string) => Effect.gen(function* () {
  const users = yield* Users
  const user = yield* users.find(id)
  return user.name
})
```

```text
error EK1002: Effect.gen expects a JavaScript generator, but in VibeLang function* declares a producer.
  Write the body as an ordinary function: remove Effect.gen, function*, and yield*.
    function findName(id: string) { return Users.find(id).name }
```

The same EK1002 applies to a `function*` passed to `Option.gen`, `Result.gen`, or another JavaScript generator API, whatever its return annotation (D370). A JavaScript generator is a generator method, or lives in a `module` declaration or a `.ts` file (Chapter 8). Outside a hatch or a `module` body, `async` is EK1003. Use `join` for a fiber and `d.await()` for a Deferred (Chapter 7, D225, D226). Converting a function is mostly deletion, as every chapter of Part I shows. EK1002's quick fix makes that conversion for `Effect.gen` wherever it keeps the program's meaning, and `vibelang --fix` applies it (D470). The editor refactor remains a design target (Chapter 28).

#### Using VibeLang code from TypeScript

To TypeScript, an exported unannotated or Effect-contract function returns a cold `Effect`, and every exported producer is a function that returns a `Stream`. The compiler writes that into the declaration file:

```ts dts
// page.d.ts
export declare const title: (id: string) => Effect.Effect<string, UserNotFound | DbError, Database>
```

```ts ts
// server.ts
import { Effect } from "effect"
import { title } from "./page.js"

const program = title("42").pipe(Effect.provide(DatabaseLive))   // nothing has run yet
```

Calling a VibeLang Effect function from TypeScript builds a program and runs nothing, like calling an `Effect.fn` function, even where the compiler gives it a plain copy for VibeLang's calls (Chapter 15): TypeScript sees an unannotated `add` as `(a: number, b: number) => Effect<number>`, and VibeLang callers in Effect code use the fast path. TypeScript imports `./page.js`, which the compiler resolves to `page.vibe` the way it resolves `.js` to `.ts`. What each declaration is to TypeScript, and when its work happens (D332):

| Declared in a `.vibe` file | TypeScript sees | When TypeScript calls it |
| --- | --- | --- |
| A function without an annotation, or with an Effect contract | `(…) => Effect<A, E, R>`, whatever its body (D500) | Nothing runs. The call keeps `this` and the argument values; each run of the `Effect` binds the parameters afresh, evaluating defaults and destructuring, and runs the body (Chapter 13, E9) |
| A function with a plain return annotation, such as `: number`, or `: infer _` (D67, D500) | `(…) => number`, or the type TypeScript infers | The body runs at once, as JavaScript's does |
| A plain function that returns a program, `(): () => number!!` | `(…) => () => Effect<number>` | The body runs at once; the function it returns builds the program |
| A producer, `function*` | `(…) => Stream<T, E, R>` | Nothing runs; consuming the `Stream` runs the body |
| A class's method | Its annotation's type. Without one, a plain method where it implements a plain member of an interface or base class its class declares, or where its name is a protocol method; an Effect method otherwise (D397) | As the function forms above |
| An object literal's method, or a function literal written as its field | Its field's destination's form (D500): without a contextual type, a method returning a cold `Effect`; where the contextual member is plain, or at a protocol key, the plain method (D484) | As the function forms above |

An unannotated method's form follows its declaration, never its body [Rule] (D397). JavaScript reaches some methods by name, without reading a declaration file: `toString`, `toLocaleString`, `valueOf`, `toJSON`, a `then` that makes an object a thenable, and a method whose key is a well-known symbol, such as `[Symbol.iterator]` or `[Symbol.dispose]`, or a protocol symbol of the pinned `effect`, such as `[Equal.symbol]` and `[Hash.symbol]`, listed in the table pinned with Effect (D369). Such a **protocol method**, and a method that implements a plain member of an interface or base class its class declares (D55), that member read by its declaration with its declaring type's own type parameters uninstantiated, as Chapter 14 reads it (D492), is checked as a plain function: a body that can pause, or let a `throw` or a listed failure escape, is EK4301. Every other unannotated method of a class is an Effect method, cold to TypeScript as an unannotated function is (D385), so adding a service call to its body changes no signature and no caller's behavior. An object literal's method, and a function literal written as an object literal's field, is instead a function at its field's destination, whose form that destination's declared type gives, as a function literal's is (Chapter 13, rule F, D500): with no contextual type, an unannotated one is an Effect function. An Effect method never satisfies a plain member of a type it is checked against, by `implements` or structurally (Chapter 14, D430). A method with a plain annotation whose body runs an Effect is EK2003, unless it implements a plain member of an interface or base class, against which it is checked (D74). A VibeLang function cannot do some work when TypeScript calls it and return an `Effect` for the rest: write such a factory in TypeScript, in a `.ts` file or a `module` declaration, where `Effect.sync` keeps its TypeScript meaning (Chapter 5, D390).

**Protocol keys** [Rule] (D484). JavaScript calls an object's protocol method by its key, whatever the object's type says, so in an object literal a field at a protocol key is a destination that accepts only the plain form, whatever contextual type the literal has.

- *Trigger.* A field of an object literal whose key is one of the protocol names above, written as an identifier, a string literal, a computed key whose type is that name's string literal type, `["toString"]`, or a computed key whose type is that symbol's own `unique symbol` type, such as `[Symbol.dispose]`, since JavaScript calls each by that key (D497). A computed key of a wider type, `string` or `symbol`, is not one.
- *Static check.* A method or a function literal written there is a **protocol member**: an unannotated one is checked as a plain function, as a class's protocol method is, so a body that can pause, or let a `throw` or a listed failure escape, is EK4301. Any other function value written there, `{ toString: describe }`, is passed as it is: a plain function is accepted, and an Effect function, an Effect-annotated method included, is EK4301 (D430). A class's protocol method with an Effect annotation keeps its annotation, since a class declares its methods' types (D397); an object literal's member is a function at its field's destination (Chapter 13, rule F).
- *Runtime.* The object holds the plain JavaScript function at that key, with no cold wrapper, so `String(label)` calls it and gets its string, `JSON.stringify` calls a `toJSON`, and `using` calls a literal's `[Symbol.dispose]` and disposes. TypeScript code receives it with its plain signature, which its declaration writes (Chapter 27).

```ts es
export const label = {
  toString() { return "ok" },              // a protocol member: String(label) is "ok"
  format(n: number) { return `#${n}` },    // an ordinary method: an Effect method, cold to every caller
}
```

A VibeLang consumer compiled against declaration files behaves as one compiled against the source for every call the declarations let it make, and treats as foreign code what nothing proves (Chapter 27, rule 2): Chapter 13's rules read only the declared types, and the declarations carry the contracts, the callbacks' written types, and the service identities, and their types say which calls return data and which functions are plain, as the source's do (D458, D500). A fact that would relax a foreign-code rule, such as that a plain function was compiled from VibeLang and cannot fail, or that a function performs no control operation (EK4202), comes only from compiler metadata that the consumer checks; without it, the function is foreign code. For plain functions that metadata is the compiler's manifest, `vibelang.manifest.json`, which lists the declaration files the compiler emitted from `.vibe` files and, for each, the exports it compiled from VibeLang, so the declarations themselves stay what TypeScript would emit (D500, D516): a consumer trusts each listed export of a module the nearest manifest above its declaration file lists, as `trustedPackages` trusts a package (D261), and a re-export of TypeScript code stays foreign. It calls those plain functions and plain methods as plain calls, with no EK4401, in plain code too unless a return type is definitely an Effect (Chapter 13, D445, D480), and their exceptions are defects, since a plain VibeLang function never fails (D282), except those of the classes a `trusted` value's type lists, which are expected failures (D400). A consumer passes `[1, 2].map(double)` the plain function, for `double(n: number): number`, as a source consumer does, and gets `[2, 4]`. A declaration whose type returns an Effect describes an Effect function, and passing one where a plain function is expected is EK4301, never a silent array of unrun Effects, to source and declaration consumers alike (Chapter 14). Chapter 27 states this declaration ABI as a rule (D366); the table above and that rule say the same thing.

#### Readonly members

An interface or an object type in a `.vibe` file has readonly members unless a member says `mutable` (D134):

```ts es
interface Cart {
  id: string
  mutable items: Array<string>
}
// interface Cart { readonly id: string; items: Array<string> }
```

The declaration file writes `readonly`, so TypeScript code sees the same types, except in an object type that is `Readonly`'s type argument, `Readonly<{ id: string }>`, where `Readonly` makes the members readonly and the declaration file writes them as TypeScript would, without a `readonly` of their own. Readonly limits writes through the type, not the object: TypeScript assigns a mutable object to a readonly type, so TypeScript passes its objects in unchanged. Index signatures follow the same rule. Class members and arrays keep TypeScript's rules: write `ReadonlyArray` or `readonly T[]` for an array the code must not change.

#### Inline TypeScript modules

A named `module` declaration at a file's top level holds TypeScript code (D283):

```ts es
module text {
  export function clean(value: string): string {
    return value.trim()
  }
}
import { clean } from text

function cleanTitle(value: string) {
  return sync((value) => clean(value), value)
}
```

The body is checked as a separate `.ts` file. JavaScript's `throw`, `catch`, `async`, `await`, and platform APIs keep their TypeScript meaning there. The body imports what it needs and cannot read the `.vibe` file's bindings. Relative imports resolve from the `.vibe` file's directory. The containing file imports exports with an identifier specifier, `from text`, rather than a string. An identifier specifier with no matching declaration is EK4407. The module's name is not a value, so `import(text)` is unsupported.

A declaration must be named, unexported, and at the file's top level. Module names are case-sensitive (D364). A nested, exported, or duplicate declaration is EK4408, as is a CommonJS `export =` or `import = require()` in its body. `module` does not declare a TypeScript namespace in a `.vibe` file. Write `namespace` for one. A module name shared with a file's value binding warns with EK4408 (D303).

The checker gives each body its own source file. For `main.vibe`, `module text` is checked as `main.vibe.text.ts`. A module declaration is an ECMAScript module (D364): it runs once, where its first import stands among the file's imports, and an import of its export is a live binding, so the containing file sees a later assignment to an exported `let`. JavaScript output gives it a module of its own, `main.vibe.text.js` beside `main.js`, which `main.js` imports with that specifier where the source wrote `from text`, so ECMAScript's own module evaluation runs it, after its own imports, in its place among the file's imports (D403). A module never imported, or imported only for types, emits no JavaScript. A top-level `await` in a used module makes the containing file await its initialization, as any imported module's does.

Declaration output writes each body's declarations to its own file, such as `main.vibe.text.d.ts`. The containing declaration file refers to it through `./main.vibe.text.js`. Cases `module-declaration-emit`, `module-declaration-cjs`, `module-declaration-order`, `module-declaration-live-bindings`, `module-declaration-cycle` and `module-declaration-reexport` cover the output.

Hatches and inline modules are the explicit TypeScript escapes. Chapter 11 shows a live binding, and Chapter 26 states the module rule.

#### Code that is not Effect

A function that does not return an `Effect` is foreign code. Nothing in its type says whether it throws, what it reads, or whether it touches the outside world, so each kind of callee has a rule:

```ts es
import { slugify } from "./slug.ts"          // exported through trusted()

function publish(draft: Draft) {
  const meta = JSON.parse(draft.frontMatter)  // a built-in: SyntaxError joins E
  const slug = slugify(meta.title)            // trusted(): lists InvalidSlug
  const words = draft.body.split(/\s+/).length
  return Articles.save({ slug, words, ...meta })
}
// Article!SyntaxError | InvalidSlug | SaveError!Articles
```

| Callee | Rule | Diagnostic |
| --- | --- | --- |
| A function whose declared return type is an `Effect`, from VibeLang or TypeScript | Calls run it (Chapter 13) | |
| A JavaScript built-in: `String`, `Array`, `Math`, `JSON`, `Number`, `Object`, `Map`, `Set`, `RegExp`, deterministic `Date` parsing | Ships with a trusted contract: a control class, and which exceptions are expected failures. Only built-ins that parse outside text declare any: `JSON.parse` fails with `SyntaxError`, `decodeURI` and `decodeURIComponent` with `URIError`; other built-in exceptions are defects (D101) | |
| An export of `effect` or an `@effect/*` package that does not return an `Effect`, and the functions and values it returns, such as a `Brand` constructor or the function `Match.exhaustive` returns | Trusted: `sync`; its exceptions are defects, as inside `Effect.gen` today | |
| A function wrapped with `trusted(impl, [Errors])` from `vibelang-runtime` | A plain trusted call, in every VibeLang function, plain code included: listed exception classes are expected failures, and any other exception is a defect (D249, D400, D445). TypeScript code receives the plain function, typed `F` with its list (D514) | |
| A platform API: `node:*` modules and browser globals such as `fetch`, `setTimeout`, `process`, `console`, `localStorage` | Not callable from `.vibe` files; the error names the Effect service to use, its import, and the layer that provides it (Chapter 11) | EK4402 |
| A clock or randomness read: `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` | Use `Clock`, `DateTime`, `Random`, and `Crypto`, so tests control them | EK4403 |
| Any other plain TypeScript or JavaScript function | Needs an explicit boundary or a trusted contract | EK4401 |
| A function value the program received, such as a parameter whose type TypeScript declares plain, `Predicate.Predicate<T>` | Called under its type: its exceptions are defects | |
| Any other global of JavaScript or of the shared web standards that does no I/O, such as `URL`, `TextEncoder`, `structuredClone`, and `Intl` | Trusted: `sync`; its exceptions are defects (D101) | |
| A value of type `any` | A plain call: its value is returned, never run (Chapter 13); calling a value that is not a function, such as an Effect value, raises a `TypeError`, a defect. Where that value is what an Effect function or a program returns, a program the callee returns would never run | EK4409, an error by default |

A trusted contract is a value declared beside the TypeScript implementation (D249):

```ts ts
// slug.ts
import { trusted } from "vibelang-runtime"
import { InvalidSlug } from "./errors.ts"

function slugifyImpl(title: string): string { … }
export const slugify = trusted(slugifyImpl, [InvalidSlug])
```

`trusted` returns one plain function [Rule] (D400, D514): it calls `impl` with its arguments and returns what `impl` returns, and it carries its list as `f[$errors]`. Its type, `Trusted<F, Errors>`, is `F & { readonly [$errors]: Errors }`, so a TypeScript caller receives a function of `impl`'s own type, which throws what `impl` throws. A VibeLang call of it is a plain trusted call, as a built-in's is (D399): an exception that is an instance of a listed class is an expected failure where the call stands, which joins E in an Effect function and which a plain function must catch, and any other exception is a defect. The compiler cannot check the TypeScript body, so the wrapper states its contract once. As a value, it is a plain function: `lines.map(slugify)` passes it, and with an empty list, `trusted(formatNameImpl, [])`, gives what `impl` gives, callable anywhere plain code is; with a non-empty list it is EK4301 where only a plain function without that list fits, as `lines.map(slugify)` is for `[InvalidSlug]`, since a listed failure would escape the receiver as a defect, and `forEach(lines, (l) => slugify(l))` keeps it expected (D514). A package listed in the tsconfig's `vibelang.trustedPackages` is also trusted (D261).

The D23 tags `@vibelang trusted` and `@throws` are deprecated. The native compiler still reads them, but reports EK4406 when their contract affects lowering in an Effect function outside a hatch. Migrate the declaration to `trusted(impl, [Errors])`. A renderer that reads one file at a time cannot see another file's tags, so it rejects such a call (EK9100) rather than lower it without its contract (D249, D366).

EK4401 applies in every function of a `.vibe` file, a function with a plain annotation included, so a plain annotation never opens a way around the trust boundary (D329). The one exception is code that no fiber can run: a module's top-level statements, and a function literal written there as an argument to a TypeScript function, such as a `describe` body or a route handler, whose exceptions go to that TypeScript code (D100). A named function is never exempt, because a fiber may call it. An exception at module top level fails the import.

A trusted call's listed failures are expected failures in every function [Rule] (D399). In a function with a plain contract, a plain-annotated function, a plain callback, or a generator method, one that can escape is EK2003 under an annotation and EK4301 for a callback, as an escaping `throw` is; the function's own `try` may catch it, and its catch receives it typed (Chapter 15). No annotation turns an expected failure into a defect: `function parse(text: string): unknown { return JSON.parse(text) }` is EK2003, and `lines.map((l) => JSON.parse(l))` is EK4301, whose repairs are `forEach(lines, (l) => JSON.parse(l))`, a `for...of` loop in an Effect function, or a `try` inside the callback. In plain code, the fixes for EK4401 are a `trusted(impl, [Errors])` value, which plain code calls as a plain trusted call (D400, D514), a package in `trustedPackages`, or a `.vibe` function; a hatch is Effect work, EK2003 under a plain annotation.

An explicit boundary, one of the hatches `sync`, `try`, and `callback` (D148), says what an exception means at the call:

```ts es
function parseLegacy(text: string) {
  return try((text) => legacyParse(text), (cause) => new LegacyFormatError({ cause }), text)   // plain TypeScript inside
}
// LegacyDoc!LegacyFormatError!
```

`try` turns an exception or a rejection into a typed error: `UnknownError`, or what its second argument makes of it. `sync` makes them defects. A hatch whose function is written `async` is called with its inputs and an `AbortSignal`, and its promise is awaited, as `Effect.promise` (`Effect.tryPromise`) awaits one; a synchronous function receives its inputs only, and its result is the hatch's result unchanged, a `Promise` or another thenable included, as `Effect.sync` (`Effect.try`) returns it; and a single expression's value is the hatch's result unchanged. To wait, write the function `async`: neither a declared return type nor a run-time test of `then` decides for a function literal (D439); a function value in first place, which has no such syntax, waits where its declared return type is a `Promise` (D503). `callback` adapts a callback API (Chapter 6). Each takes either a function, `try(() => { … })` or `try(async (signal) => …)`, or a single expression evaluated when the hatch runs, `sync(crypto.randomUUID())`, and syntax tells the two apart (D396): a function literal in first place, an arrow function or a `function` expression, is the hatch's function, and any other first argument is a single expression, whose value is the hatch's result, unless its type is a function, which the hatch calls with the inputs (D503). A hatch's first argument is plain TypeScript, not VibeLang: calls there do not run, so calling a `.vibe` function gives an inert Effect value for `runPromise` or `runFork`; `throw`, `async`, and `await` keep their JavaScript meaning; platform APIs and clock reads are allowed (no EK4401, EK4402, or EK4403); and `return` returns from the hatch's function. Effect's `{ try, catch }` options object is EK4404: the hatch takes the code and the error mapping as two arguments.

That TypeScript is self-contained (D229). It may use its own parameters and locals, globals, imports, and the file's error declarations, but no other binding of the `.vibe` file: not a local, a parameter, or a module declaration. A value reaches it as an input (D230), an argument after the function that fills the function's first parameters, as `text` does above. An async function receives its `AbortSignal` after the inputs, and a callback's register function receives `resume` and the signal after them. `try`'s error mapper stays the second argument, so inputs follow it (D231). Only the first argument is TypeScript: the mapper and the inputs are VibeLang, so a call among the inputs runs before the hatch starts, and the mapper may read the file's bindings, as `cartId` below (D232). A binding read from outside is EK4405 (quick fix: pass it as an input); an enclosing function's `this` and `arguments` count as its bindings (D327). A `.vibe` function is a binding too, so a hatch that leads back in takes it as an input: `sync(async (load) => runPromise(load()), loadReport)`. Inputs keep `callback`'s type arguments from being written, so its `resume` parameter takes the prelude type instead: `callback((source, resume: Resume<number, Error>) => …, source)`.

The rule is deliberately strict, so a hatch's function reads like a standalone TypeScript function and could move to a `.ts` file unchanged; a later version may relax it.

A hatch has one calling convention, which the hatch's spelling and its first argument decide: a function literal by its syntax, `async` or not, and any other first argument by its type, a function value whose declared return type is a `Promise` waiting (D330, D503, D517):

- **Recognition.** A call is a hatch when its callee is spelled `sync`, `try`, or `callback` and resolves to the prelude's binding (Chapter 13, rule H4); a local named `sync` is an ordinary function. A hatch is used only as a callee and only under its own name: `const run = sync`, `import { sync as boundary } from "vibelang-runtime"`, and `R.sync(…)` through a namespace import of the runtime are EK4410, since a value could not keep its first argument's TypeScript or its argument positions, and a renamed callee would hide that its first argument is deferred (D432). TypeScript code calls the runtime's `sync`, `try`, and `callback` with a function: TypeScript evaluates an argument before the call, so the single-expression form is `.vibe` syntax only, and TypeScript imports `try`, a reserved word, under another name (D456).
- **Arguments.** `sync(code, ...inputs)`, `try(code, mapper, ...inputs)`, `callback(register, ...inputs)`. `try`'s second argument is always the mapper; to pass a function as the first input without a mapper, write `try(code, undefined, input)`.
- **Function or expression.** A function literal in first place is the hatch's function; any other first argument is a single expression, evaluated when the hatch runs (D396). Where a single expression's type is a function, the hatch calls it with the inputs, as a TypeScript reader of `Effect.sync(Math.random)` expects: `sync(Math.random)` gives a number, and `sync(count, 1, 2)`, with `count` imported from TypeScript, calls `count(1, 2)` (D503). Inputs after a single expression whose type is not a function are EK4411, since nothing would receive them, and so is a first argument whose type mixes a function with other members.
- **Order.** The hatch evaluates its first argument, then the mapper, then the inputs, left to right, each once, as any call does (rule E1). A call among the inputs or in the mapper runs before the hatch starts. A single expression in first place is the one exception: the hatch evaluates it when it runs, after the other arguments, inside the boundary it sets.
- **Sync or async.** A function written `async` is asynchronous: the hatch calls it with its inputs and then an `AbortSignal`, which interruption aborts, and waits for its promise. Its parameters must accept that call, which TypeScript checks, so `sync(async (a: number, b?: number) => …, 1)` is a type error rather than a `b` that receives the signal. Any other function literal is synchronous and receives its inputs only, and its result is the hatch's result as it is, a `Promise` or another thenable included, as `Effect.sync` and `Effect.try` return one (D439). To wait on a promise, write the function `async`; for a function literal, neither the declared return type nor a run-time test decides. A function value in first place has no such syntax, so its declared return type decides: one returning a `Promise` is asynchronous, and receives the `AbortSignal` after its inputs where it declares a parameter there, other than a rest parameter, whose type accepts one; any other is synchronous (D503). `callback`'s register function receives its inputs, then `resume`, then the `AbortSignal` (D230).

`runPromise`, `runFork`, `runSync`, and `runCallback` are in the prelude as the way back in, called from plain TypeScript (a `.ts` file, a hatch's body, or a module's top level), never from code a fiber runs (EK1005).

An exception that no contract lists is a defect, and an Effect catch does not see it, unlike JavaScript catch inside `Effect.gen`. That includes the exceptions of Effect's "cannot fail here" functions, such as `Option.getOrThrow` and `Schema.decodeUnknownSync`, which `effect`'s trusted contracts classify as defects. A plain function's catch does not see it either (D282) (Chapter 3).

JavaScript, not VibeLang, sets a boundary's limits: it cannot discover a dependency the function reaches through a global or a module variable, cancel synchronous JavaScript once started, or let a synchronous callback pause. Effect code today has the same limits.

This changes policy from the original direction, which adapted every plain call automatically, with unknown errors and unknown requirements. The premise stays: foreign code is untrusted until something vouches for it. The vouching now happens once, explicitly, at a boundary or on a declaration, so an unprovidable `unknown` never enters a requirement and an `unknown` error never spreads to every caller. Pure helpers written in `.vibe` with a plain return annotation compile to plain JavaScript, and unannotated ones get inferred contracts (Chapter 15), so most project code never needs a boundary.

#### What the compiler checks and what it trusts

A contract's E bounds the expected failures, the `Fail` reasons, of checked VibeLang code; defects and interruption are outside it (Chapter 17). The bound rests on assumptions the compiler cannot check, listed once as the trusted base in Chapter 26 (D332, D373): above all, that TypeScript declarations are true, that a trusted contract's list of errors is right, that `any` and type assertions are honest, that a library calls a callback only as its type says, and that Chapter 16's table of combinators that change fibers is right. A wrong assumption can turn an expected failure into a defect, or let a typed program fail at run time. Trust attaches to the declaration a call resolves to. The functions and values that Effect's own exports return are trusted too (D121), since Effect's version is pinned; values that other trusted functions return are not. A plain annotation adds no trust.

#### Promises

Outside a hatch, `await` appears only in the await operations (D226), so a Promise from a TypeScript library is waited on with the `try` hatch, which says what a rejection means and passes an `AbortSignal` so interruption can cancel the request:

```ts es
import { createCharge } from "./payments-sdk.ts"   // (amount: number, signal: AbortSignal) => Promise<Charge>

function charge(cartId: string, amount: number) {
  return try(async (amount, signal) => createCharge(amount, signal), (cause) => new ChargeFailed({ cartId, cause }), amount)
}
// Charge!ChargeFailed!
```

HTTP itself goes through Effect's `HttpClient`, not `fetch` (Chapter 11).

#### Callbacks into plain JavaScript

A JavaScript function such as `Array.prototype.map` calls its callback synchronously, so the callback cannot pause. A callback that only computes is fine, a call of a plain VibeLang function such as `double(n: number): number` included, as is a plain VibeLang function passed as a value (Chapter 13, D445). A call of an unannotated helper there is rejected, since the helper is an Effect function whatever its body (D500), and the quick fix writes the helper's return type. A callback that calls a service is rejected, with the fix in the message:

```ts es
const trimmed = ids.map((id) => id.trim())         // fine
const doubled = counts.map((n) => double(n))       // fine: double(n: number): number is a plain function
const users = ids.map((id) => Users.find(id))      // rejected
```

```text
error EK4301: This callback can't run Users.find(id), an Effect: Array.prototype.map
  calls it synchronously, as a plain function.
  Use Effect.forEach(ids, (id) => Users.find(id)) or a for...of loop.
```

Effect's own combinators, such as `Effect.forEach`, expect callbacks that return Effects, so VibeLang callbacks work there; Chapter 16 gives the rules for higher-order functions.

#### Effect 3

VibeLang targets Effect 4 only; Effect 3 values do not run on the Effect 4 runtime. Code that must call an Effect 3 library wraps it as foreign code, for example with an `async` `try` hatch around `Effect3.runPromise`: `try(async (program, signal) => Effect3.runPromise(program, { signal }), (error) => …, program)`. The function is written `async` so that the hatch waits for the promise and passes a rejection to the mapper; a synchronous function's promise would be the hatch's result as it is, unwaited (D439). Waiting does not by itself stop the Effect 3 program when the hatch is interrupted: passing the hatch's `AbortSignal` to `runPromise` does.
