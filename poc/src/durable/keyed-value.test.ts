import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { canonicalJson } from "./value.ts"
import { decodeKeyedValue, encodeKeyedValue, keyedValuePath, KeyedValueError, KEYED_VALUE_LIMITS } from "./keyed-value.ts"

test("checked-in upstream cache measurements match the runtime codec without a reference dependency", () => {
  const oracle = JSON.parse(readFileSync(new URL("../../../compiler/testdata/keyed-value-oracle.json", import.meta.url), "utf8"))
  expect(oracle.revision).toBe("6bcbaa2d03a10afe8fe59934dabe262f55f012e7")
  expect(oracle.effectVersion).toBe("4.0.0-rc.112")
  expect(oracle.abi).toBe("vibelang/keyed-source/v2")
  expect(oracle.records).toHaveLength(5)
  for (const fixture of oracle.records) {
    expect(encodeKeyedValue(fixture.value)).toEqual(fixture.encoded)
    expect(JSON.parse(canonicalJson(fixture.encoded))).toEqual(fixture.stored)
    expect(JSON.stringify(decodeKeyedValue(fixture.stored))).toBe(JSON.stringify(fixture.value))
  }
})

for (const value of [null, false, true, 0, 42, 1e-7, "🚀", [], {}, [1, { z: 2, a: 3 }], { z: 1, a: { y: 2, b: 3 } },
  JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"toString":2}'),
  JSON.parse('{"10":1,"2":2,"z":3,"a":4}')]) {
  test(`keyed value survives canonical persistence: ${JSON.stringify(value)}`, () => {
    const encoded = encodeKeyedValue(value)
    const restored = decodeKeyedValue(JSON.parse(canonicalJson(encoded)))
    expect(JSON.stringify(restored)).toBe(JSON.stringify(value))
    expect(encodeKeyedValue(restored)).toEqual(encoded)
    if (restored !== null && typeof restored === "object" && !Array.isArray(restored)) {
      expect(Object.getPrototypeOf(restored)).toBe(Object.prototype)
      expect(Object.isFrozen(restored)).toBe(false)
    }
  })
}

test("order is bound in the value and cannot collide in a structural cache", () => {
  expect(canonicalJson({z: 1, a: 2})).toBe(canonicalJson({a: 2, z: 1}))
  expect(canonicalJson(encodeKeyedValue({z: 1, a: 2}))).not.toBe(canonicalJson(encodeKeyedValue({a: 2, z: 1})))
})

test("wire-looking authored data remains data, including prototype names", () => {
  const value = { kind: "object", items: { z: 1, a: 2 }, order: ["not", "metadata"] }
  expect(decodeKeyedValue(encodeKeyedValue(value))).toEqual(value)
  const own = decodeKeyedValue(encodeKeyedValue(JSON.parse('{"__proto__":41}'))) as object
  expect(Object.hasOwn(own, "__proto__")).toBe(true)
  expect(Object.getPrototypeOf(own)).toBe(Object.prototype)
})

test("projected encoded subtrees retain their own order and are independently decodable", () => {
  const wire = encodeKeyedValue({ z: [{ b: 2, a: 1 }], unrelated: 0 })
  const path = keyedValuePath(["z", "0"])
  expect(path).toEqual(["items", "z", "items", "0"])
  let projected: any = JSON.parse(canonicalJson(wire))
  for (const key of path) projected = projected[key]
  expect(JSON.stringify(decodeKeyedValue(projected))).toBe('{"b":2,"a":1}')
  expect(keyedValuePath([])).toEqual([])
})

test("snapshots do not retain mutable aliases, and duplicate noncyclic references are values", () => {
  const item = { z: 1, a: 2 }, value = [item, item]
  const wire = encodeKeyedValue(value)
  item.z = 9
  const restored = decodeKeyedValue(wire) as {z: number}[]
  expect(restored[0].z).toBe(1)
  expect(restored[0]).not.toBe(restored[1])
  restored[0].z = 8
  expect(restored[1].z).toBe(1)
  expect(Object.isFrozen(wire)).toBe(true)
})

let invoked = 0
const getter = Object.defineProperty({}, "x", {enumerable: true, get() { invoked++; return 1 }})
const proxy = new Proxy({}, {ownKeys() { invoked++; throw new Error("executed proxy") }})
const revoked = Proxy.revocable({}, {}); revoked.revoke()
const cycle: any = {}; cycle.self = cycle
for (const [name, value] of Object.entries({
  undefined, bigint: 1n, function: () => { invoked++ }, nan: NaN, infinity: Infinity, negativeZero: -0,
  surrogate: "\ud800", lowSurrogate: "\udfff", getter, proxy, revoked: revoked.proxy,
  nestedProxy: {x: proxy}, cycle, sparse: Array(1), extraArray: Object.assign([1], {x: 2}),
  hidden: Object.defineProperty({}, "x", {value: 1}), symbol: {[Symbol("s")]: 1},
  date: new Date(0), map: new Map(), toJSON: {toJSON() { invoked++; return 1 }},
})) test(`keyed codec refuses ${name} without evaluating it`, () => {
  const before = invoked
  expect(() => encodeKeyedValue(value)).toThrow(KeyedValueError)
  expect(() => decodeKeyedValue(value)).toThrow(KeyedValueError)
  expect(invoked).toBe(before)
})

for (const value of [[], {}, {kind: "array", items: {}, extra: true}, {kind: "array", items: [] , extra: true},
  {kind: "object", items: {a: 1}, order: []}, {kind: "object", items: {a: 1, b: 2}, order: ["a", "a"]},
  {kind: "object", items: {a: 1}, order: ["toString"]}, {kind: "object", items: {a: 1}, order: [1]},
  {kind: "object", items: {"2": 2, "1": 1}, order: ["2", "1"]},
  {kind: "object", items: {a: 1}, order: ["a"], approved: true},
]) test(`malformed keyed value refuses: ${JSON.stringify(value)}`, () => {
  expect(() => decodeKeyedValue(value)).toThrow(KeyedValueError)
})

test("limits charge encoded metadata and bound bytes, keys, traversal and paths", () => {
  let depth: unknown = 0
  for (let i = 0; i < 64; i++) depth = [depth]
  expect(() => encodeKeyedValue(depth)).not.toThrow()
  depth = [depth]
  expect(() => encodeKeyedValue(depth)).toThrow(/traversal budget/)
  expect(() => encodeKeyedValue("x".repeat(KEYED_VALUE_LIMITS.bytes))).toThrow(/byte budget/)
  expect(() => encodeKeyedValue({["x".repeat(KEYED_VALUE_LIMITS.keyBytes + 1)]: 1})).toThrow(/property name/)
  expect(() => encodeKeyedValue(Array(34_000).fill({}))).toThrow(/traversal budget/)
  expect(() => keyedValuePath(Array(65).fill("x"))).toThrow()
  expect(() => keyedValuePath([1] as unknown as string[])).toThrow()
})
