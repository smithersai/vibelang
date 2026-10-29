import { Effect } from "effect"
/** @throws {never} */
export function values(events: string[]): ReadonlyArray<Effect.Effect<number> & (() => Effect.Effect<number>)> {
 const effect = Effect.sync(() => { events.push("ran"); return 1 })
 const callable = () => Effect.sync(() => { events.push("called"); return 2 })
 Object.setPrototypeOf(callable, effect)
 return [callable as unknown as Effect.Effect<number> & (() => Effect.Effect<number>)]
}
