import { expect, test } from "bun:test"
import fc from "fast-check"
import { $matchCache } from "../src/match-cache"

// VIP-7: "Those sections use %Map%, %Set% and %Array% internally."
// The pinned cache algorithms call %Map.prototype.has%,
// %Map.prototype.get% and %Map.prototype.set%, rather than user properties.
// Internal iterator registration and cleanup have the same intrinsic boundary.
for (const mode of ["reuse", "create", "restart", "close"] as const) {
  test("iterator cache keeps intrinsic Map operations: " + mode, () => {
    fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 20 }), fc.boolean(), (values, replaceConstructor) => {
      const OriginalMap = Map
      const descriptors = new Map<PropertyKey, PropertyDescriptor>()
      const keys = ["has", "get", "set", "clear", "values", Symbol.iterator] as const
      for (const key of keys) descriptors.set(key, Object.getOwnPropertyDescriptor(OriginalMap.prototype, key)!)
      const savedDescriptors = Array.from(descriptors)
      let calls = 0, closes = 0, index = 0
      const source = {
        [Symbol.iterator]() {
          index = 0
          return {
            next() { return index < values.length ? { value: values[index++], done: false } : { done: true } },
            return() { closes++; return { done: true } }
          }
        }
      }
      let cache: ReturnType<typeof $matchCache> | undefined
      if (mode !== "create") cache = $matchCache()
      if (mode === "reuse" || mode === "close") cache!.iterable(source)
      let result: unknown, error: unknown
      const poison = () => { calls++; throw new Error("user Map operation") }
      try {
        for (const key of keys) Object.defineProperty(OriginalMap.prototype, key, { ...Object.getOwnPropertyDescriptor(OriginalMap.prototype, key), value: poison })
        if (replaceConstructor) globalThis.Map = poison as unknown as MapConstructor
        if (mode === "create") cache = $matchCache()
        if (mode === "restart") cache!.start()
        if (mode === "close") {
          cache!.finish()
          result = closes
        } else {
          const iterable = cache!.iterable(source)
          const first = cache!.has(source, 0) ? cache!.at(source, 0) : undefined
          result = [iterable, first, cache!.rest(source, 0)]
          cache!.finish()
        }
      } catch (caught) { error = caught }
      finally {
        globalThis.Map = OriginalMap
        for (const [key, descriptor] of savedDescriptors) Object.defineProperty(OriginalMap.prototype, key, descriptor)
        cache?.finish()
      }
      expect(error).toBeUndefined()
      expect(calls).toBe(0)
      expect(result).toEqual(mode === "close" ? 1 : [true, values[0], values])
    }), { numRuns: 100 })
  })
}
