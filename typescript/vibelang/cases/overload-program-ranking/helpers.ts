import { Effect } from "effect"

// Effect 4.1.0 has no Effect.orElse. Keep the two-program fallback API
// here to exercise D257 without adding or changing a dependency.
/** @vibelang trusted */
export function orElse<B, E2, R2>(that: Effect.Effect<B, E2, R2>, options?: { readonly unused?: boolean }): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A | B, E2, R | R2>
export function orElse<A, E, R, B, E2, R2>(self: Effect.Effect<A, E, R>, that: Effect.Effect<B, E2, R2>): Effect.Effect<A | B, E2, R | R2>
export function orElse(self: any, that?: any): any {
  return Effect.isEffect(that) ? Effect.catch(self, () => that) : (value: any) => Effect.catch(value, () => self)
}

// A declaration-only ambient fixture has the same runtime binding that a
// library global would; each case runs in its own Node process.
Object.assign(globalThis, { orElse })

// A preferred form must still be applicable: Effect<number> cannot match.
export function applicable(value: number): Effect.Effect<"value">
export function applicable(program: Effect.Effect<string>): Effect.Effect<"program">
export function applicable(value: number | Effect.Effect<string>) {
  return Effect.succeed(Effect.isEffect(value) ? "program" as const : "value" as const)
}
