# VIP-27: declaration output and `@throws`

**Status:** accepted, 2026-10-29, under Will's standing approval of recommendations ("assume I accept now. I will interrupt you if I need to").

## Decision

```ts
// load.vibe
export effect load(id: string) { … }
export function parse(s: string) { if (!s) throw new BadInput(); return s }
export function add(a: number, b: number) { return a + b }

// load.d.vibe.ts, written next to load.vibe
export declare const load: (id: string) => Effect<User, NotFound, Users>
/** @throws {BadInput} */
export declare function parse(s: string): string
/** @throws {never} */
export declare function add(a: number, b: number): number
```

- **Content.** Declarations are exactly what idiomatic Effect TypeScript would declare, per Will's earlier ruling (D501).
- **Location.** `x.d.vibe.ts` is written next to each `x.vibe`, which TypeScript's `allowArbitraryExtensions` resolves, so plain `tsc`, TypeDoc and `bun check` understand `.vibe` imports. A package build also writes ordinary `.d.ts` files to its output directory.
- **`@throws`.** Every exported function carries `@throws`: its inferred thrown type, or `@throws {never}` when it can't throw. Under VIP-4, a function with no `@throws` throws `unknown`.
- The `@throws` annotations VibeLang ships for JavaScript's globals (VIP-4) use the same spelling.

## Prior art

Svelte's and Vue's TypeScript tooling; CSS modules' `.d.css.ts`; TypeScript's `allowArbitraryExtensions`.
