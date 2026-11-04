import { Effect } from "effect"
export const tail = (value: any) => Effect.gen(function* () { return yield* value })
export const bound = (value: any) => Effect.gen(function* () { const result = yield* value; return result })
export const factory = (make: () => any) => Effect.gen(function* () { return yield* make() })
export const grouped = (value: any) => Effect.gen(function* () { return (yield* value) })
export const array = (value: any) => Effect.gen(function* () { return [yield* value] })

export const known = (value: Effect.Effect<number>) => Effect.gen(function* () { return yield* value })
export const knownFactory = (make: () => Effect.Effect<number>) => Effect.gen(function* () { return yield* make() })
export const knownGeneric = <T extends Effect.Effect<number>>(value: T) => Effect.gen(function* () { return yield* value })

export function makeZero(value: any) { return function () { return Effect.gen(function* () { return yield* value }) } }
export function makeNamedZero(value: any) { return function chosen() { return Effect.gen(function* () { return yield* value }) } }
export function makeArrowZero(value: any) { return () => Effect.gen(function* () { return yield* value }) }
export function makeOne(value: any) { return function (input: any) { return Effect.gen(function* () { return yield* input }) } }
export function makeThisZero(value: any) { return function (this: { value: any }) { const receiver = this; return Effect.gen(function* () { return yield* receiver.value }) } }
export function makeSelfZero(value: any) {
 return function chosen() { return Effect.gen(function* () { return yield* ((chosen as any).program ?? value) }) }
}
export function makeCapturedRestZero(...args: any[]) { return function () { return Effect.gen(function* () { return yield* args[0] }) } }
