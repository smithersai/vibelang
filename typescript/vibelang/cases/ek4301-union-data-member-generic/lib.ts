import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

// alchemy's Resource, ResourceClassLike and Platform, with the witness
// field ResourceClassLike requires: a generic data member of the union.
export interface Res<R> {
  (id: string): Effect.Effect<R>
  readonly witness: R
}

export interface Like<R> {
  readonly witness: R
}

export interface Plat {
  (id: string, props: number): any
  readonly platform: true
}

export const Thing: Res<number> = Object.assign((_id: string) => Effect.succeed(1), { witness: 1 })

export class S extends Context.Service<S, { readonly value: number }>()("test/S") {}

export const operation = (n: number): Effect.Effect<number, never, S> => Effect.map(Effect.service(S), (s) => s.value + n)

// alchemy's Provider.effect: the program's run may require services at call
// time, which RunR infers.
export const register = <W, Req = never, RunR = never>(
  cls: Like<W> | Plat,
  program: Effect.Effect<{ readonly run: (n: number) => Effect.Effect<number, never, RunR> }, never, Req>,
): Effect.Effect<string, never, Req | RunR> =>
  Effect.flatMap(program, (p) => Effect.map(p.run(2), (n) => `${"platform" in cls ? "platform" : String(cls.witness)}:${n}`))

// alchemy's Provider.collection([Account, Certificate]): an array of a type
// parameter whose constraint is the union, whose callable member is generic.
export interface PlatOf<R> {
  (id: string, props: number): any
  readonly platform: R
}

export const Certificate: Res<string> = Object.assign((_id: string) => Effect.succeed("cert"), { witness: "cert" })

export const collection = <T extends Like<any> | PlatOf<any>>(resources: T[]): Effect.Effect<number> =>
  Effect.succeed(resources.filter((r) => !("platform" in r)).length)
