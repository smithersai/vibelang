// The chapter's local typing witness: the native loop keeps the element type,
// and the `number` annotation checks the selected element before String(n).
import { Effect } from "effect"
const numericMatcher: unique symbol =
  ((Symbol as typeof Symbol & { readonly customMatcher?: symbol }).customMatcher ?? Symbol.for("Symbol.customMatcher")) as any
class Numeric {
  static [numericMatcher](s: unknown, _options: { matchType: "extractor" }): false | [number] {
    return typeof s === "number" ? [s] : false
  }
}
function selectOne(s: number[]): IteratorResult<number, undefined> {
  let selected: IteratorResult<number, undefined> = { done: true, value: undefined }
  for (const value of s) {
    if (!selected.done) return { done: true, value: undefined }
    selected = { done: false, value }
  }
  return selected
}
export function first(s: number[]) {
  const selected = selectOne(s)
  if (!selected.done) {
    const n: number = selected.value
    return String(n)
  }
  return "other"
}
export function numeric(s: unknown) {
  const extracted = Numeric[numericMatcher](s, { matchType: "extractor" })
  if (extracted !== false) {
    const [n] = extracted
    return String(n)
  }
  return "other"
}
export function firstValue(s: number[]) {
  const selected = selectOne(s)
  if (!selected.done) {
    const n: number = selected.value
    return n
  }
  return undefined
}
export function numericValue(s: unknown) {
  const extracted = Numeric[numericMatcher](s, { matchType: "extractor" })
  if (extracted !== false) {
    const [n] = extracted
    return n
  }
  return undefined
}
export function main(): Effect.Effect<readonly unknown[]> {
  return Effect.sync(() => [
    [first([1]), first([]), first([1, 2])],
    [numeric(7), numeric("7")],
    [firstValue([1]) ?? null, firstValue([1, 2]) ?? null, numericValue(7) ?? null, numericValue("7") ?? null],
  ])
}
