import { Effect, Path } from "effect"
export function main() { return Effect.provide(Effect.gen(function* () {
 const path = yield* Path.Path; return path.join("a", "b")
}), Path.layer) }
