import { Effect as Fx } from "effect"
export type Kind = "literal" | "grouped" | "held" | "spread" | "single" | "empty"
/** @throws never */
export function nativeObserve(kind: Kind) {
  return Fx.sync(() => {
    const a: Fx.Effect<number, string> = Fx.succeed(7)
    const b: Fx.Effect<number, string> = Fx.fail("e")
    const rows: Array<Fx.Effect<number, string>> = kind === "empty" ? [] : kind === "single" ? [a] : [a, b]
    const prototype: any = Array.prototype
    const oldMap = prototype.map
    const oldIterator = prototype[Symbol.iterator]
    let maps = 0, iterators = 0
    const matches = (xs: any[]) => xs.length === rows.length && xs.every((v, i) => v === rows[i])
    const work = Fx.gen(function* () {
      const Effect = { all: 0, exit: 0 }
      switch (kind) {
        case "grouped": return yield* Fx.all(([Fx.exit(a), Fx.exit(b)]), { concurrency: "unbounded" })
        case "held": return yield* Fx.all(rows.map(Fx.exit), { concurrency: "unbounded" })
        case "spread": {
          const source = [...rows]
          return yield* Fx.all(source.map(Fx.exit), { concurrency: "unbounded" })
        }
        case "single": return yield* Fx.all([Fx.exit(a)], { concurrency: "unbounded" })
        case "empty": return yield* Fx.all([], { concurrency: "unbounded" })
        default: return yield* Fx.all([Fx.exit(a), Fx.exit(b)], { concurrency: "unbounded" })
      }
    })
    try {
      prototype.map = function (this: any[], callback: any, thisArg: any) {
        if (matches(this)) maps++
        return Reflect.apply(oldMap, this, [callback, thisArg])
      }
      prototype[Symbol.iterator] = function (this: any[]) {
        if (rows.length > 0 && matches(this)) iterators++
        return Reflect.apply(oldIterator, this, [])
      }
      const exits = Fx.runSync(work)
      return { maps, iterators, exits }
    } finally {
      prototype.map = oldMap
      prototype[Symbol.iterator] = oldIterator
    }
  }).pipe(Fx.map(({ maps, iterators, exits }) => ({ maps, iterators, tags: exits.map((x) => x._tag) })))
}
