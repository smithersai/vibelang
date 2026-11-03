import * as Effect from "effect/Effect"
// alchemy-25: packages/railway/src/AuthProvider.ts:109, minimized by drive-alchemy (nyc-02 repros/round3-auth-provider-types/minimal.ts).
interface A { readonly _A: unique symbol }
interface B { readonly _B: unique symbol }
type E = { readonly message: string }
type Config = { method: "x" } | { method: "y" }
interface Impl<C, R> { configure(name: string): Effect.Effect<C, E, R | A> }
declare const register: <C>() => <R = never, InitR = never>(impl: Impl<C,R> | Effect.Effect<Impl<C,R>,never,InitR>) => R | InitR
declare const first: Effect.Effect<{method:"x"}, E, A | B>
declare const second: Effect.Effect<Config, E, A>
export const provider = register<Config>()(Effect.gen(function* () {
  const configure = (name: string) => (name ? first : second).pipe(Effect.mapError(e => e))
  return { configure }
}))
