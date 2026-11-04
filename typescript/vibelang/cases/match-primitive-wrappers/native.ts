type Extract = (subject: unknown) => unknown
/** @throws {never} */
export function probe(direct: Extract, aliased: Extract, rest: Extract, boolean: Extract, unused: Extract, empty: Extract, oversized: Extract, alternative: Extract): string {
  const values = ["x", "", 0, -0, NaN, Infinity, true, false, 3n, Symbol.for("x")]
  for (const [name, extract] of [["direct", direct], ["alias", aliased]] as const) {
    for (const value of values) {
      if (!Object.is(extract(value), value)) return name + ": primitive " + typeof value
      if (!Object.is(extract(Object(value)), value)) return name + ": boxed " + typeof value
    }
    const box = new String("before")
    let reads = 0
    Object.defineProperty(box, "valueOf", { get() {
      reads++
      return function(this: unknown) { if (this !== box) return "wrong receiver"; reads++; return "after" }
    } })
    const actual = extract(box)
    if (actual !== "after" || reads !== 2) return name + ": valueOf expected after/2 got " + String(actual) + "/" + reads
    if (extract(null) !== "miss" || extract({}) !== "miss") return name + ": nonmatching object"
    for (const [C, value] of [[String, "x"], [Number, 2], [Boolean, false], [BigInt, 3n], [Symbol, Symbol.for("x")]] as const) {
      const original = Object.getOwnPropertyDescriptor(C.prototype, "valueOf")!
      try {
        Object.defineProperty(C.prototype, "valueOf", { configurable: true, value() { return "wrong" } })
        if (!Object.is(extract(value), value)) return name + ": primitive valueOf " + C.name
      } finally { Object.defineProperty(C.prototype, "valueOf", original) }
    }
  }
  for (const [name, extract, expected, count] of [["elision", unused, true, 1], ["empty", empty, false, 1], ["oversized", oversized, false, 1], ["alternative", alternative, true, 2]] as const) {
    const box = new String("x")
    let calls = 0
    Object.defineProperty(box, "valueOf", { value() { calls++; return "x" } })
    const actual = extract(box)
    if (actual !== expected || calls !== count) return name + ": expected " + expected + "/" + count + " got " + String(actual) + "/" + calls
  }
  if (rest(new String("x")) !== "x" || rest("x") !== "x") return "rest extraction"
  if (boolean(new String("x")) !== true || boolean(2) !== false) return "Boolean recognition"
  return "ok"
}
