import {Effect,Stream,Queue} from "effect"
function values(){return Stream.callback<string>(q=>Effect.gen(function*(){function* native(){yield "native"};for(const n of native())yield* Queue.offer(q,n)}).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}
export function main():Effect.Effect<unknown>{return Stream.runCollect(values())}
