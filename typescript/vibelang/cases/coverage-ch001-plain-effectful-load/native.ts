import { Data, Effect } from "effect"
class BadInput extends Data.TaggedError("BadInput") {}
const seen: string[] = []
function fetchUser(id: string) { return Effect.gen(function* () { seen.push(id); return "user-" + id }) }
function load(id: string) { return id ? fetchUser(id) : Effect.fail(new BadInput()) }
export function main() { return Effect.gen(function* () {
 seen.length = 0
 const bad = yield* Effect.catch(load(""), error => Effect.succeed(error._tag))
 const good = yield* load("u")
 return { bad, good, calls: [...seen] }
}) }
// Chapter 001 direct-call control: raw JavaScript throws defect inside Effect.gen.
export function directControl() { return Effect.gen(function* () { throw new Error("native defect") }) }

type AssertNever<T extends never> = T
type FailureOf<T> = T extends Effect.Effect<infer A, infer E, infer R> ? E : never
type DirectControlHasNoTypedFailure = AssertNever<FailureOf<ReturnType<typeof directControl>>>
