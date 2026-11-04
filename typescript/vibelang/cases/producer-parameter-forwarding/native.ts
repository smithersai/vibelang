import { Effect, Queue, Stream } from "effect"
function values(x: number) {
 return Stream.callback<number>(queue => Effect.gen(function* () {
   yield* Queue.offer(queue,x)
 }).pipe(Effect.andThen(Queue.end(queue))), {bufferSize:1,strategy:"suspend"})
}
export function defaulted(x: number = 7) { return values(x) }
export function prefixed(a: number, x: number = 7) { return values(a + x) }
export function destructured({x}: {x:number} = {x:7}) { return values(x) }
export const rested = function(x: number = 7, ...tail: number[]) { return values(x + tail.length) }
export const method = { run(x: number = 7) { return values(x) } }.run
export function array([x]: number[] = [7]) { return values(x) }
