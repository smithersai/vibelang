import { Effect } from "effect"
export const events: string[] = []
export function plain(value: any) { return Effect.gen(function* () { return yield* value }) }
export function conditional(value: any) { return Effect.gen(function* () { return true ? yield* value : 0 }) }
export function comma(value: any) { return Effect.gen(function* () { return (events.push("tail"), yield* value) }) }
export const arrow = (value: any) => Effect.gen(function* () { return yield* value })
export const expression = function (value: any) { return Effect.gen(function* () { return yield* value }) }
export const object = { run(value: any) { return Effect.gen(function* () { return yield* value }) } }
export class Handler { run(value: any) { return Effect.gen(function* () { return yield* value }) } }
export function known(value: Effect.Effect<number>) { return Effect.gen(function* () { return yield* value }) }
