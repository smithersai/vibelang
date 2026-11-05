import { test, expect } from "bun:test"

test("match: property caches preserve false and undefined observations, identity, keys and evaluation boundaries", async () => {
  const { $matchCache } = await import("../src/match-cache")
  const fc = await import("fast-check")
  fc.assert(fc.property(fc.array(fc.constantFrom("0", "__proto__", "value", "constructor"), {minLength: 1, maxLength: 20}), fc.boolean(), (keys, present) => {
    const trace: string[] = []
    const symbol = Symbol("value")
    const subject = new Proxy(Object.create(null), {
      has(_target, key) { trace.push("has:" + String(key)); return present },
      get(_target, key) { trace.push("get:" + String(key)); return undefined }
    })
    const cache = $matchCache()
    for (const key of [...keys, symbol, symbol]) {
      expect(cache.propertyHas(subject, key)).toBe(present)
      expect(cache.get(subject, key)).toBeUndefined()
    }
    expect(trace.length).toBe((new Set(keys).size + 1) * 2)
    const before = trace.length
    expect(cache.get(subject, 0)).toBeUndefined()
    expect(cache.get(subject, "0")).toBeUndefined()
    expect(trace.length - before).toBe(keys.includes("0") ? 0 : 1)
    const other = new Proxy(subject, {})
    cache.get(other, symbol)
    expect(trace.length - before).toBe(keys.includes("0") ? 1 : 2)
    $matchCache().get(subject, symbol)
    expect(trace.length - before).toBe(keys.includes("0") ? 2 : 3)
  }), {numRuns: 150, seed: 70401})
})

test("match: cache operations use captured Map methods and retry abrupt reads", async () => {
  const { $matchCache } = await import("../src/match-cache")
  const cache = $matchCache()
  let calls = 0
  const subject = { get value() { if (++calls === 1) throw new Error("first"); return 3 } }
  expect(() => cache.get(subject, "value")).toThrow("first")
  const oldHas = Map.prototype.has, oldGet = Map.prototype.get, oldSet = Map.prototype.set
  let first: unknown, second: unknown, present: unknown
  try {
    Map.prototype.has = Map.prototype.get = Map.prototype.set = (() => { throw new Error("user map") }) as any
    first = cache.get(subject, "value")
    second = cache.get(subject, "value")
    present = cache.propertyHas(subject, "value")
  } finally {
    Map.prototype.has = oldHas; Map.prototype.get = oldGet; Map.prototype.set = oldSet
  }
  expect([first, second, present, calls]).toEqual([3, 3, true, 2])
})

