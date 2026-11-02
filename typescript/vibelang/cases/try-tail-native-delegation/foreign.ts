import { Effect } from "effect"
export const modes = ["number","undefined","promise","array","return-generator","yield-generator","effect","iterator-throw","next-throw","bad-result"] as const
/** @throws {never} */
export function makeValue(mode: typeof modes[number], record: (s: string) => void): { value: any; sentinel: Error } {
  const sentinel = new Error("iterator sentinel")
  switch (mode) {
    case "number": return { value: 5, sentinel }
    case "undefined": return { value: undefined, sentinel }
    case "promise": return { value: Promise.resolve(5), sentinel }
    case "array": return { value: [], sentinel }
    case "return-generator": return { value: (function* () { return 7 })(), sentinel }
    case "yield-generator": return { value: (function* () { return yield* Effect.succeed(8) })(), sentinel }
    case "effect": {
      const value = Effect.succeed(7)
      const base = value[Symbol.iterator].bind(value)
      Object.defineProperty(value, Symbol.iterator, { get() { record("iterator"); return base } })
      return { value, sentinel }
    }
    case "iterator-throw": return { value: { get [Symbol.iterator]() { record("iterator"); throw sentinel } }, sentinel }
    case "next-throw": return { value: { [Symbol.iterator]() { record("iterator"); return { get next() { record("next"); throw sentinel } } } }, sentinel }
    case "bad-result": return { value: { [Symbol.iterator]() { record("iterator"); return { next() { record("next"); return 3 } } } }, sentinel }
  }
  throw new Error("bad mode")
}
