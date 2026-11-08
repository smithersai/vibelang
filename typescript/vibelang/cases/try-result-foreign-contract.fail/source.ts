import * as Effect from "effect/Effect"
export interface NS {
  getByName: (name: string) => string
  /** @throws {never} */
  safe(name: string): string
}
const make = (): NS => ({ getByName: (name) => name, safe: (name) => name })
export const ns: Effect.Effect<NS> = Effect.sync(make)
export const holder: { readonly ns: Effect.Effect<NS> } = { ns }
export const obj: NS = make()
