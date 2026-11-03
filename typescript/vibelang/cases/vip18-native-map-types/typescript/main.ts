import { Effect, Exit } from "effect"
export function held(rows: readonly [Effect.Effect<number>, Effect.Effect<number>]) {
  return Effect.gen(function* () {
    return yield* Effect.all(rows.map(Effect.exit), { concurrency: "unbounded" })
  })
}
export function literal(rows: readonly [Effect.Effect<number>, Effect.Effect<string>]) {
  return Effect.gen(function* () {
    return yield* Effect.all([Effect.exit(rows[0]), Effect.exit(rows[1])], { concurrency: "unbounded" })
  })
}
export function spread(rows: readonly [Effect.Effect<number>, Effect.Effect<number>]) {
  return Effect.gen(function* () {
    return yield* Effect.all([Effect.exit(Effect.succeed("prefix")), ...[...rows].map(Effect.exit), Effect.exit(Effect.succeed(true))], { concurrency: "unbounded" })
  })
}
export function iterable(rows: Set<Effect.Effect<number>>) {
  return Effect.gen(function* () {
    return yield* Effect.all([...rows].map(Effect.exit), { concurrency: "unbounded" })
  })
}
export function empty(rows: readonly []) {
  return Effect.gen(function* () {
    return yield* Effect.all(rows.map(Effect.exit), { concurrency: "unbounded" })
  })
}
export function main() {
  return Effect.gen(function* () {
    const rows = [Effect.succeed(1), Effect.succeed(2)] as const
    const h = yield* held(rows)
    const l = yield* literal([rows[0], Effect.succeed("two")])
    const n: Exit.Exit<number, never> = l[0]
    const s: Exit.Exit<string, never> = l[1]
    const length: 2 = l.length
    const spreadRows = yield* spread(rows)
    const prefix: Exit.Exit<string, never> = spreadRows[0]
    const set = yield* iterable(new Set(rows))
    return { held: h.length, literal: length, spread: spreadRows.length - 2, set: set.length }
  })
}
export function widened(rows: ReadonlyArray<Effect.Effect<number> | Effect.Effect<string>>) {
  return Effect.gen(function* () {
    const tasks: ReadonlyArray<Effect.Effect<number | string>> = rows
    return yield* Effect.all(tasks.map(Effect.exit), { concurrency: "unbounded" })
  })
}
