### 2. Functions and calls

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

#### Every function is an Effect

Every function is an Effect: the compiler infers its contract `Effect<A, E, R>` from its body, and TypeScript sees the function as one that returns that cold `Effect`, so calling it from TypeScript runs nothing. Three kinds of function are not: a function or method with a plain return annotation, such as `: number`, or `: infer _`, which lets TypeScript infer that type, is a plain JavaScript function to every caller (Chapter 15, D500); a method that implements a plain member of an interface or base class its class declares, or a JavaScript protocol method such as `toString` or `[Symbol.iterator]`, is plain too, because JavaScript calls it without reading its type (Chapter 10, D397); and a producer, `function*`, returns a `Stream` (Chapter 8). Inside VibeLang, calling a function runs it where the call stands (below), and writing `() =>` before a call delays it. Some functions can fail, need services, or pause; the contract records which.

```ts es
function add(a: number, b: number) {
  return a + b
}
// number!!

function greeting(id: string) {
  const user = Users.find(id)
  return `Hello, ${user.name}`
}
// string!UserNotFound!Users
```

A function's form is written, never read from its body (D500). `add` performs no Effect operation and cannot fail, but it has no return annotation, so it is an Effect function, `number!!`: a call of it in an Effect function runs, and costs what a JavaScript call costs through the plain copy the compiler gives it (Chapter 15), while TypeScript sees `(a: number, b: number) => Effect<number>`. A module's top level and a `map` callback run as plain JavaScript, so they may call only plain functions: written `function add(a: number, b: number): number`, `add` is one, which every caller, VibeLang and TypeScript alike, calls as JavaScript, and a call of the unannotated `add` there is EK1001 at the top level and EK4301 in the callback, whose quick fix writes that annotation. `greeting` can fail and needs `Users`, so it is an Effect function, and a plain annotation on it would be EK2003.

#### Calling runs the function

A call works the way a TypeScript developer reads it with an implicit `await`: its arguments are evaluated, left to right, then the function runs where the call stands, and the call's value is the function's success value. If the callee fails, the caller fails with the same error unless it catches it (Chapter 3). There is no `yield*` or `await`. Whether a call runs depends on the declared return type of the signature it resolves to, an Effect or not, and overloads resolve as TypeScript resolves them: where two overloads accept the same arguments, the first one decides, as it decides whether a TypeScript call returns a `Promise`, and a function written as an argument takes its form, plain or Effect, from the parameter type of that overload, unless its own return annotation writes the form (Chapter 13, D482, D500). Nothing else changes when the call runs: not the parameter it fills, not an annotation on the variable that receives it.

```ts effect
const userName = Effect.fn("userName")(function* (id: string) {
  const users = yield* Users
  const user = yield* users.find(id)
  const name = user.name.trim()
  yield* Effect.log(`found ${name}`)
  return name
})
```

```ts es
function userName(id: string) {
  const name = Users.find(id).name.trim()
  log(`found ${name}`)
  return name
}
```

Where Effect sequences with `Effect.map`, `flatMap`, `andThen`, or `tap`, VibeLang uses the value, then the next statement.

#### Control flow is ordinary JavaScript

Loops, conditions, early returns, and local variables work as in any function, with effectful calls anywhere inside.

```ts effect
const notifyAll = Effect.fn("notifyAll")(function* (ids: ReadonlyArray<string>) {
  const users = yield* Users
  let sent = 0
  for (const id of ids) {
    const user = yield* users.find(id)
    if (!user.subscribed) continue
    yield* welcome(id)
    sent++
  }
  return sent
})
```

```ts es
function notifyAll(ids: ReadonlyArray<string>) {
  let sent = 0
  for (const id of ids) {
    const user = Users.find(id)
    if (!user.subscribed) continue
    welcome(id)
    sent++
  }
  return sent
}
// number!UserNotFound | MailError!Users | Mailer
```

The loop runs one `welcome` at a time, in order. Running several at once is always explicit (Chapter 7).

#### Tracing

`Effect.fn("welcome")` gives every call a span. VibeLang functions compile to untraced frames by default, because a traced frame costs 10 to 20 times more (Chapter 24). Add a span where you want one with Effect's `withSpan`, which takes the program to trace:

```ts es
function welcomeTraced(id: string) {
  return withSpan(() => welcome(id), "welcome")
}
```

The arrow is a program (Chapter 13), so `withSpan` runs `welcome(id)` inside the span. `withSpan(welcome(id), "welcome")` would run `welcome(id)` first, outside the span, and is EK1018.

#### Writing the contract yourself

Most functions leave the contract to inference. Write one to have the compiler check a promise, typically on exported functions. The annotation describes the whole computation, as `Promise<string>` does on an `async` function: the `return` is checked against `string`.

```ts es
export function greeting(id: string): string!UserNotFound!Users {
  const user = Users.find(id)
  return `Hello, ${user.name}`
}
```

A contract may be wider than what the body does, never narrower:

```ts es
export function greeting(id: string): string!!Users {
  return `Hello, ${Users.find(id).name}`
}
```

```text
error EK2001: UserNotFound can escape greeting, but its contract says E = never.
  greeting.vibe:2:22   return `Hello, ${Users.find(id).name}`
                                      ^^^^^^^^^^^^^ Users.find can fail with UserNotFound
  Catch it inside greeting, or change the contract to Effect<string, UserNotFound, Users>.
```

To check only some channels, write `infer` and a name in each channel the compiler should infer (D57):

```ts es
function greeting(id: string): Effect<string, infer E, infer R> {
  return `Hello, ${Users.find(id).name}`
}
// string!UserNotFound!Users
```

Here A is checked; E and R come from the body. `Effect<string, never, infer R>` instead promises no expected failures and infers services. A type argument left out of `Effect<…>` means what it means in TypeScript, `never`, and is checked: `Effect<string>` is `string!!`, a function that cannot fail and needs nothing ([Chapter 14](#14-contracts-and-inference), D309). The name after `infer` is documentation only; it introduces no type variable.

#### Calling TypeScript

VibeLang calls TypeScript functions directly; what a call does depends on what the function returns:

```ts es
import { loadAvatar } from "./avatars.ts"    // (id: string) => Avatar!AvatarError!Storage
import { formatName } from "./format.ts"     // trusted(formatNameImpl, [])

function profileCard(id: string) {
  const user = Users.find(id)
  return {
    title: formatName(user),                 // trusted(): returns the formatted name
    avatar: loadAvatar(user.id)              // returns an Effect, so the call runs it
  }
}
// { title: string; avatar: Avatar }!UserNotFound | AvatarError!Users | Storage
```

A TypeScript function whose declared return type is an `Effect` behaves exactly like a VibeLang function: calling it runs it. One that returns anything else is foreign code: nothing says what its exceptions mean, so the compiler asks you to say it once, and reports every call until you do, in plain functions too. `formatName` is a `trusted(impl, [Errors])` value exported beside its TypeScript implementation, so the call is a plain call of its plain form, which classifies the exceptions it lists, in plain functions too, while TypeScript code receives a function that returns an `Effect` (D249, D445, Chapter 10). Without one, the call is an error that offers the fixes:

```text
error EK4401: formatName is a plain TypeScript function, and nothing says what its exceptions mean.
  profile-card.vibe:7:12   title: formatName(user),
  Declare its failures once with trusted(formatName, [Errors]) from "vibelang-runtime", and call that value.
  Or bound this call:       try((user) => formatName(user), (cause) => new FormatError({ cause }), user)
  Or move it into a .vibe file, where its contract is inferred.
```

Effect's own modules (`Option`, `Array`, `Schedule`, and the rest) and JavaScript's built-ins (`String`, `Math`, `JSON`, and the rest) need none of this: their contracts ship with the compiler. Effect's modules replace Node.js and browser APIs (Chapter 11).
