# VIP-1: `effect` and `async` functions

**Status:** accepted by Will, 2026-10-28.

## Decision

```ts
effect function load(id) { return try fetchUser(id) }   // an Effect function
effect (id) => try fetchUser(id)                        // arrow

async function get(q) { return await queryDb(q) }      // a Promise function, as in TypeScript

class Users {
  effect find(id) { … }                                  // method
  async load() { … }
}

const c = (id) => fetchUser(id)   // neither keyword: plain JavaScript; returns the Effect unrun
```

- `effect` marks an Effect function, and `async` marks a Promise function. **Amended 2026-10-29: `effect` goes exactly where TypeScript allows `async`** (`effect function f()`, `effect function (x) {}`, `effect (x) =>`, `effect find()` in a class or object literal). The top-level shorthands `effect f()` and `async f()` are removed, because neither is TypeScript and Will wanted `function` visible. Outside those positions `effect` is an ordinary identifier, so `Layer.effect` and `const effect = …` still work.
- Inside an `effect` function, `try` runs an Effect (VIP-5). Inside an `async` function, `await` waits for a Promise, exactly as in JavaScript. Either keyword used in the other kind of function is an error.
- Calling an `effect` function returns its Effect unrun, just as calling an `async` function returns a Promise.
- An `effect` function's return type is an Effect, just as an `async` function's is a Promise. Like any function's return type, it can be written or left out, in which case it is inferred. An inferred type takes its success from what the function returns, and its errors and requirements from the Effects its body runs, as `Effect.gen` infers them.

  ```ts
  effect function load(id): User!NotFound!Users { return try fetchUser(id) }             // written
  effect function load(id) { return try fetchUser(id) }                                  // inferred: the same type
  async function get(q): Promise<Row[]> { return await queryDb(q) }                      // as in TypeScript
  ```

- A Promise used inside an `effect` function is wrapped with `tryPromise` or `promise`. An Effect used inside an `async` function goes through `runPromise`. All three are VIP-6 globals.
- **Amended 2026-10-29: `new f()` on a `.vibe` function** gets TypeScript's own error only, with no stricter VibeLang check (the old EK1020 check is deleted). Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: recursive inference** reports only TypeScript's own errors (TS7022, TS7023, TS7024); the old partial-slot rules of EK2102 are deleted. Sent to Will on Telegram 2026-10-29 12:28 under his standing rule 'assume I accept'; no objection by 13:00.
- **Amended 2026-10-29: no direct `eval` or `arguments`.** Direct `eval` and `arguments` are compile errors anywhere in a `.vibe` file, plain functions included; code that needs them lives in a `.ts` or `.js` file. Will: "anything problematic from js legacy should be forced to be wrapped in js either coming from a ts or js file … Even writing a normal sync js function should be banning things like eval arguments etc." Decided by Will on factory.vibelang.sh, 2026-10-29 ~14:20–14:25 ("revisit-r5"). Whether `new Function`, `var` and `with` are banned too was pending his confirmation; the next amendment decides it.
- **Amended 2026-10-29: legacy JavaScript banned in all `.vibe` code.** Direct and indirect `eval`, `new Function` (and `Function(...)`), `arguments` (use rest parameters), `var` (use `let`/`const`) and `with` are each a compile error with a quick fix anywhere in a `.vibe` file, plain functions included. Legacy JavaScript lives in `.ts`/`.js` files and `module` bodies (VIP-40). This replaces the previous amendment's pending list. Decided by Will, 2026-10-29 15:57: "I don't have every api memorized that's on the agent to do a good job."
- **Amended 2026-10-29: every reference to the global `Function`.** The legacy-JavaScript ban covers every `IdentifierReference` that resolves to the global `Function`, except the right operand of `instanceof` and the object of a member access: `const F = Function` is an error; `x instanceof Function` and `Function.prototype.toString.call(f)` are allowed. The type `Function` stays TypeScript's. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 33).
- **Amended 2026-10-29: `effect` and `async` together.** `effect` and `async` on one function is a compile error, with quick fixes that remove one modifier: no Effect TypeScript function is both an `Effect.gen` and a Promise-returning `async` function. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 46).
- **Amended 2026-10-29: `Function` through `.constructor`.** Reading a property named `constructor` from a value whose static type is a function type or `Function` is `EK0107`; `(async () => {}).constructor` reaches the `AsyncFunction` constructor. Values typed `any` are not tracked. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 75).
- **Amended 2026-10-29: the `Function` member-access exemption covers `.prototype` only.** The exemption for the object of a member access narrows to a statically named `prototype` (`Function.prototype`, `Function?.prototype`, `Function["prototype"]`, and the same through `globalThis.Function`). Every other member of the global `Function` (`Function.call(null, "return 7")`, `Function.name`) is `EK0107`; the `instanceof` exemption stays. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 97).

- **Amended 2026-10-30: bindings behave as in an `async` body.** An `effect` body reads `this`, `super` and `new.target` exactly as the same body reads them in an `async` function of the same form: the same bindings, at the same step of evaluation, with the same errors. Building the Effect reads none of them. This replaces the helper recipe: how the compiler passes them in is its choice, and the spec keeps the reviewers' counterexamples as checked examples. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later".

- **Amended 2026-10-31: the `effect` arrow-head code.** A recognized `effect` arrow head that breaks its required form, a typed or generic bare parameter, is `EK0109`. This classifies a rejection and changes no admitted program. Decided by the agent under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 247).

## Amendment: inferred Effect arguments (2026-11-03)

Grounds: accepted VIP-1 says "Calling an `effect` function returns its Effect unrun"; VIP-5 says "`try e` runs the Effect `e`"; VIP-34 says "Warning severities can be adjusted in the config's `"vibe"` section". These establish cold calls, explicit execution and configurable warnings. This amendment records the agents' advisory `EK4802` trigger, not a direct answer from Will requiring rejection.

`EK4802` keeps its configurable severity (warning by default, VIP-34); it changes neither TypeScript inference nor runtime execution. A warning can be ignored or configured to `"off"`, leaving the Effect argument unrun; it does not enforce an error or an inserted `try`. The VIP-1 migration's project-wide severity override covers inferred Effect arguments.

The stronger requirement relayed by effectscript-11 on 2026-11-03 08:20Z, "must be an error or get its try, never silently pass the Effect", is not fulfilled by that advisory warning. Its authority and the inferred-argument policy remain the separate R19 OPUS-5 question, which remains open with Will; this wording does not settle it.

In effect code, a plain call whose own inferred type argument is an Effect reports `EK4802` at each argument that uses that type parameter outside a declared Effect position. Inspect the resolved signature's unsubstituted parameter types, following unions, intersections, container type arguments such as `T[]` and `Promise<T>`, object properties, and callback parameter and result types; stop at a declared Effect position such as `Effect.Effect<T>`. This includes overloads, methods and `T extends unknown`. A signature with a declared Effect result is excluded, as are arguments already run with `try`, explicit call type arguments and explicitly instantiated callees. Only ordinary call expressions are inspected, not the execution syntax nodes `try e`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork` and its scoped forms, `join`, `catch`, `for try`, `for concurrent`, `provide`, `uninterruptible`, `interruptible` or `restore`. Ordinary calls inside their operands, heads and bodies are still inspected when they are in effect code. A VIP-40 `module name { … }` declaration body is TypeScript code and is excluded. Nested plain or `async` functions keep TypeScript's inference; a nested `effect` body is inspected independently outside a module declaration body. Composition calls such as `pipe(e, Effect.map(f))` and `e.pipe(Effect.map(f))` follow the same argument-position test, including callback contracts; `pipe` has no name-based exemption.

Writing the call's type arguments explicitly opts out: `expect<Effect.Effect<number>>(e)` passes the program as data. An explicitly instantiated callee, such as `const checkProgram = expect<Effect.Effect<number>>`, also keeps the program. A declared `Effect.Effect<T>` parameter accepts a program without explicit type arguments. To pass a result instead, write `expect(try e)`. The editor offers `try` for a direct Effect-valued argument when the enclosing written failure and requirement contract accepts it; this action checks those channels, not the edited call's overloads, other arguments or expected result type. A container or callback needs its Effect run where constructed, or the editor action to write explicit type arguments; a non-Effect callback never receives `try`. Batch `--fix` rechecks the edited program and refuses a `try` repair that adds an error, including a broken `pipe` callback contract, and never chooses that opt-out.

## Amendment: modifier placement diagnostics

A recognized `effect` modifier follows the valid and diagnostic recovery positions of TypeScript’s `async`. On an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member, it is `EK0108`. TypeScript parses `async` as a modifier on an `interface` or type literal member before a member name or `[` (TS1070, TS1071); `effect` is recognized there, so this code reports it. Valid function/class overload signatures follow ordinary TypeScript admission and compatibility; the code does not reject a valid overload or admit a generator overload. A starred bodyless signature keeps TypeScript’s `TS1222`. A signature without a return annotation exposes `any`, with `TS7010` under `noImplicitAny`, as the bodyless `async` signature does; a written Effect type gives it a checked contract. Recognition is syntactic: an identifier-named method such as `interface Ordinary { effect(): number }` has no Effect modifier. Ordinary TypeScript syntax retains its native diagnostics. The existing getter/setter/constructor rejection is `EK0104`, and combining `async` and `effect` is `EK0105`; both may apply to one accessor. An error or schema-error member retains these applicable diagnostics without an extra member-category error (VIP-13).

## Amendment: mixed block modifier recovery

`effect async { B }` and `async effect { B }` remain rejected, with `EK0105`, as mixed function modifiers are. The parser recognizes both block heads for that diagnostic. A function repair can remove either modifier; the block repair removes `async`, keeping VIP-2’s `effect { B }`. No `async { B }` or runtime hybrid is added.

## Amendment: formal-parameter diagnostics

A forbidden `await` expression in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`. A forbidden `yield` expression there has the [producer diagnostic](../src/002-running.md#producers), and `try` keeps its [outside-Effect diagnostic](../src/002-running.md#static-rules). Defaults, destructuring defaults and computed binding keys use the same source boundary. Nested source callable or context boundaries keep their own native rules; this permits no parameter suspension.

## Prior art

- JavaScript and TypeScript `async function`, C# `async`, Rust `async fn`, Kotlin `suspend fun`. In each, a keyword on the function, never its body, decides its kind.
- Effect's `Effect.fn` and `Effect.gen`.

## Will's words

> "We should keep async await meaning promises. We should have effectful function use the keyword effect … await unwraps both. … awaiting a promise is not allowed in an effect function and awaiting an effect is not allowed in a async function."

> "I like your suggestion of having effect function load and just effect load. Let's do same with async so you can do async function get() or just async get()."

> "Going between effect and async already has existing support in promise if you are suggesting we should have more concise syntax for that keep that in mind but for another proposal."

> "obviously the return type of an effect function is an Effect. Just update VIP-1 to include this detail. Mention also that like any other function it can be inferred" (added 2026-10-28)

*Updated by VIP-5 (2026-10-28): `try`, not `await`, runs an Effect, and `await` means only what it means in JavaScript.*

*Corrected 2026-10-29: the return-type example uses `effect function` and `async function`, as the 2026-10-29 amendment requires.*

*Corrected 2026-10-29: the examples call `queryDb`, a Promise-returning function imported from a `.ts` module, because VIP-33 forbids platform calls such as `fetch` anywhere in a `.vibe` file.*

*Corrected 2026-11-02: the written return type is `User!NotFound!Users` (VIP-3), as chapter 1 writes the same example; a bare `Effect<A, E, R>` type is not a VibeLang form (decided detail 260), and with Effect's modules in scope `Effect` names the namespace (found by the round-7 review).*

## Alternative considered and withdrawn (2026-10-29)

Will proposed, then withdrew, making every function effectful by default, with `sync function` for plain functions and `async function` for Promises. His reason was that the docs' first page "was way less intimidating when it had function keyword". `effect function` keeps the `function` keyword visible instead. Effectful-by-default would have required `sync` on most callbacks (`xs.map(sync (x) => x + 1)`). A context-dependent default (declarations effectful, argument arrows plain) was rejected as "too complex".

> "I think we should use effect modifier and default should be a plain function but should we do effect function or should we do effect nameOfFunction() {}?" … "Yea let's do it"

## Footnote: old VibeLang

Old VibeLang is a reference only; nothing in it is part of the language unless a VIP adds it. For implementers, this VIP replaces:


D550 (a function's kind inferred from `await` in its body), D541, the form rules of D500, and D456's "`async` only in a hatch".

## Left to later VIPs

- What `using` and Stream iteration mean inside an `effect` function. (`throw` is VIP-4, and `try`/`catch` is VIP-5.)
- Top-level `await` and `main`.

### Amendment: recursion depth (2026-11-01)

Plain functions have JavaScript's stack limit; recursion that must be stack-safe is written as an `effect` function. Running a recursive Effect with `try` uses Effect's stack-safe execution, as `yield*` does inside `Effect.gen`. A plain recursion's stack overflow is an implicit `RangeError`; its exact failing depth depends on the runtime. This clarifies VIP-1's ordinary-JavaScript function model and adds no explicit-throw permission.
