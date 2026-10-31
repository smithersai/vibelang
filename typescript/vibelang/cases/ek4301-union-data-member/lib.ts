import * as Effect from "effect/Effect"

// A resource class: callable, returning an Effect, with fields, as alchemy's
// Resource is.
export interface Res<R> {
  (id: string): Effect.Effect<R>
  readonly kind: string
}

// alchemy's ResourceClassLike: data, with no call signature.
export interface Like<R> {
  readonly kind: string
  readonly witness?: R
}

// alchemy's Platform: the union's only callable member.
export interface Plat {
  (id: string, props: number): any
  readonly platform: true
}

export const Res = <R>(kind: string, value: R): Res<R> => Object.assign((_id: string) => Effect.succeed(value), { kind })

export const register = <R>(cls: Like<R> | Plat): string => ("platform" in cls ? "platform" : cls.kind)
