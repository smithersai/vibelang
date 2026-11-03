import { Effect, Stream, Data } from "effect"
class Missing extends Data.TaggedError("Missing")<{ readonly code: number }> {
 private helper() { return this.code }
 get label() { return this.helper() }
 compute() { const self = this; return Effect.gen(function* () { return self.label + 1 }) }
 effect() { return 4 }
}
export function main() { return Effect.gen(function* () {
 const item = new Missing({ code: 2 })
 return [item.label, yield* item.compute(), item.effect()]
}) }
