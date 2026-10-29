# VIP-39: `effect` goes exactly where `async` goes

**Status:** accepted by Will, 2026-10-29. Amends VIP-1, which has been updated to match.

## Decision

```ts
effect function welcome(id) { … }       // declaration, like async function
const f = effect function (id) { … }    // function expression
effect (id) => try load(id)             // arrow, like async (id) =>
class Users { effect find(id) { … } }   // method, like async find() in a class or object literal
effect { … }                            // block (VIP-2), unchanged

function slug(s) { … }                  // no modifier: a plain function, as in TypeScript
async function get(url) { … }           // Promise, as in TypeScript
```

- `effect` may appear exactly where TypeScript allows `async`, and nowhere else. The top-level shorthands `effect name() {}` and `async name() {}` from VIP-1 are removed, because neither is TypeScript. A method keeps `effect find() {}`, as TypeScript allows `async find() {}`.
- A function with no modifier is plain, as VIP-1 decided.
- **Ambiguity: none.** These are the positions where TypeScript already parses `async`.

## Alternative considered and withdrawn

Will proposed, then withdrew, making every function effectful by default, with `sync function` for plain functions and `async function` for Promises. His reason was that the docs' first page "was way less intimidating when it had function keyword". `effect function` keeps the `function` keyword visible. Effectful-by-default would have required `sync` on most callbacks, such as `xs.map(sync (x) => x + 1)`. A context-dependent default (declarations effectful, argument arrows plain) was rejected as "too complex".

## Will's words

> "I think we should use effect modifier and default should be a plain function but should we do effect function or should we do effect nameOfFunction() {}?"

> "Yea let's do it"
