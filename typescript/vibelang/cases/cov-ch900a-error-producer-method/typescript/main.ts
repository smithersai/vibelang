import { Effect, Stream, Data } from "effect"
class Missing extends Data.TaggedError("Missing")<{ readonly code: number }> {
 values() { return Stream.suspend(() => Stream.make(this.code)) }
 effect() { return 4 }
}
export function main() { return Effect.gen(function* () {
 const item = new Missing({ code: 2 })
 return [(yield* Stream.runCollect(item.values())).length, item.effect()]
}) }
