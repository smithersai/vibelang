import { Effect } from "effect"

function witness(): boolean[] {
  const matcher = { limit: 2, test(s: unknown): boolean { return typeof s === "number" && s > this.limit } }
  const xs: unknown[] = [3, 1, null]
  return xs.map(s => matcher.test(s))
}

function neighborhood() {
  const trace: string[] = []
  const matcher = {
    limit: 2,
    test(s: unknown, hint: { matchType: string }): s is number {
      trace.push("call:" + hint.matchType + ":" + this.limit)
      return typeof s === "number" && s > this.limit
    },
    extract(s: unknown, hint: { matchType: string }): number[] | false {
      trace.push("call:" + hint.matchType + ":" + this.limit)
      return typeof s === "number" && s > this.limit ? [s - this.limit] : false
    }
  }
  const test = matcher.test
  Object.defineProperty(matcher, "test", { get() { trace.push("test"); return test } })
  const holder = { get current() { trace.push("base"); return matcher } }
  const keys = {
    get test(): "test" { trace.push("key"); return "test" },
    get extract(): "extract" { trace.push("key"); return "extract" }
  }
  const subjects: unknown[] = [3, 1, null]
  const dotted = subjects.map(s => holder.current.test(s, { matchType: "boolean" }) ? s + 1 : 0)
  const computed = subjects.map(s => holder.current[keys.test](s, { matchType: "boolean" }))
  const extracted = subjects.map(s => (() => { const r = holder.current[keys.extract](s, { matchType: "extractor" }); return r === false ? -1 : r[0] })())
  const negated = subjects.map(s => !holder.current.test(s, { matchType: "boolean" }))
  const nested = holder.current.test(3, { matchType: "boolean" })
  return { dotted, computed, extracted, negated, nested, trace }
}

function protocols() {
  const observations: boolean[] = []
  const method = function(this: unknown, _s: unknown, hint: { matchType: string }, receiver: unknown): boolean | number[] {
    observations.push(this === owner.predicate, receiver === owner)
    return hint.matchType === "extractor" ? [7] : true
  }
  const owner = {
    limit: 2,
    predicate: Object.assign(function(this: { limit: number }, s: unknown): boolean {
      return typeof s === "number" && s > this.limit
    }, { [Symbol.for("Symbol.customMatcher")]: method })
  }
  Object.defineProperty(owner.predicate, "call", { value: () => false })
  Object.defineProperty(owner.predicate, "bind", { value: () => () => false })
  const bare = Boolean(Reflect.apply(method, owner.predicate, [3, { matchType: "boolean" }, owner]))
  const extracted = (Reflect.apply(method, owner.predicate, [3, { matchType: "extractor" }, owner]) as number[])[0]
  return { bare, extracted, observations }
}

export function main() {
  return Effect.succeed({ witness: witness(), neighborhood: neighborhood(), protocols: protocols() })
}

console.log(JSON.stringify(Effect.runSync(main())))
