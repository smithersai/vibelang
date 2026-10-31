// alchemy-25: Railway's and Cloudflare's AuthProvider register an
// implementation built inside a callback, whose configure pipes a union of
// Effects. TypeScript 5.9 and 7.0.2 infer R = B from configure's
// requirements; 7.1's cached inference from type arguments (upstream
// c8e9b7d25926) inferred never and rejected the call (TS2345).
import * as Effect from "effect/Effect"

export interface A { readonly a: "A" }
export interface B { readonly b: "B" }
type E = { readonly message: string }
type Config = { method: "x" } | { method: "y" }
interface Impl<C, R> { configure(name: string): Effect.Effect<C, E, R | A> }

const register = <C>() => <R = never, InitR = never>(impl: Impl<C, R> | Effect.Effect<Impl<C, R>, never, InitR>): Effect.Effect<string, never, R | InitR> =>
  Effect.as(Effect.isEffect(impl) ? impl : Effect.succeed(impl), "registered")

const first = Effect.succeed({ method: "x" as const }) as Effect.Effect<{ method: "x" }, E, A | B>
const second = Effect.succeed({ method: "y" as const }) as Effect.Effect<Config, E, A>

export const provider = register<Config>()(Effect.sync(() => {
  const configure = (name: string) => (name ? first : second).pipe(Effect.mapError((e) => e))
  return { configure }
}))
