import {Effect} from "effect"
import {sleep} from "effect/Effect"
export type Task=Effect.Effect<number>
export const global=Effect.sleep("1 millis")
export function value(){return Effect.gen(function*(){return 1})}
export function execute(input:Task){return Effect.gen(function*(){return yield* input})}
export function delay(){return Effect.gen(function*(){yield* sleep("1 millis");return 1})}
export function main(){return Effect.gen(function*(){return [yield* value(),yield* execute(value()),yield* delay()]})}
