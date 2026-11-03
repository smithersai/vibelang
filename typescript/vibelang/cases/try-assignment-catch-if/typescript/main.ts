// expect-result: [0,"observed","created","updated","Other",["create","create","update","create"]]
import * as Effect from "effect/Effect"
interface Item { readonly id: string }
type Err = { readonly _tag: "Conflict" } | { readonly _tag: "Other" }
type Mode = "create" | "conflict" | "other"
const events: string[] = []

function create(mode: Mode): Effect.Effect<Item, Err> {
  return Effect.gen(function* () {
    events.push("create")
    if (mode === "conflict") return yield* Effect.fail<Err>({ _tag: "Conflict" })
    if (mode === "other") return yield* Effect.fail<Err>({ _tag: "Other" })
    return { id: "created" }
  })
}
function update(): Effect.Effect<Item> {
  return Effect.gen(function* () { events.push("update"); return { id: "updated" } })
}
export function caught(observed: Item | undefined, mode: Mode) {
  return Effect.gen(function* () {
    let current = observed
    if (current === undefined) {
      current = yield* Effect.catchIf(
        create(mode),
        (e): e is { readonly _tag: "Conflict" } => e._tag === "Conflict",
        () => update()
      )
      return current.id
    }
    return current.id
  })
}

type Errors<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false)
  : false
type Assert<T extends true> = T
type UnhandledError = Assert<Equal<Errors<ReturnType<typeof caught>>, { readonly _tag: "Other" }>>

export function main() {
  return Effect.gen(function* () {
    const before = events.length
    const observed = yield* caught({ id: "observed" }, "other")
    const created = yield* caught(undefined, "create")
    const updated = yield* caught(undefined, "conflict")
    const failed = yield* Effect.match(caught(undefined, "other"), {
      onFailure: (e) => e._tag, onSuccess: (value) => value
    })
    return [before, observed, created, updated, failed, events]
  })
}
