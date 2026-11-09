import { Effect } from "effect"
import { risky } from "./foreign.js"
const xs: readonly number[] = [1, 2]
export function main() {
 return Effect.gen(function* () {
  const map = yield* Effect.exit(Effect.try(() => xs.map(n => risky(n))))
  if (map._tag !== "Success") return false
  const filter = yield* Effect.exit(Effect.try(() => xs.filter(n => risky(n) > 0)))
  if (filter._tag !== "Success") return false
  const flatMap = yield* Effect.exit(Effect.try(() => xs.flatMap(n => [risky(n)])))
  if (flatMap._tag !== "Success") return false
  const forEach = yield* Effect.exit(Effect.try(() => xs.forEach(n => risky(n))))
  if (forEach._tag !== "Success") return false
  const reduce = yield* Effect.exit(Effect.try(() => xs.reduce((a, n) => a + risky(n), 0)))
  if (reduce._tag !== "Success") return false
  const reduceRight = yield* Effect.exit(Effect.try(() => xs.reduceRight((a, n) => a + risky(n), 0)))
  if (reduceRight._tag !== "Success") return false
  const some = yield* Effect.exit(Effect.try(() => xs.some(n => risky(n) > 0)))
  if (some._tag !== "Success") return false
  const every = yield* Effect.exit(Effect.try(() => xs.every(n => risky(n) > 0)))
  if (every._tag !== "Success") return false
  const find = yield* Effect.exit(Effect.try(() => xs.find(n => risky(n) > 0)))
  if (find._tag !== "Success") return false
  const findIndex = yield* Effect.exit(Effect.try(() => xs.findIndex(n => risky(n) > 0)))
  if (findIndex._tag !== "Success") return false
  const findLast = yield* Effect.exit(Effect.try(() => xs.findLast(n => risky(n) > 0)))
  if (findLast._tag !== "Success") return false
  const findLastIndex = yield* Effect.exit(Effect.try(() => xs.findLastIndex(n => risky(n) > 0)))
  if (findLastIndex._tag !== "Success") return false
  const sort = yield* Effect.exit(Effect.try(() => [...xs].sort((a, b) => risky(a) - b)))
  if (sort._tag !== "Success") return false
  const toSorted = yield* Effect.exit(Effect.try(() => xs.toSorted((a, b) => risky(a) - b)))
  if (toSorted._tag !== "Success") return false
  const from = yield* Effect.exit(Effect.try(() => Array.from(xs, n => risky(n))))
  if (from._tag !== "Success") return false
  const flat = yield* Effect.exit(Effect.try(() => xs.map(n => [risky(n)]).flat()))
  if (flat._tag !== "Success") return false
  const nested = yield* Effect.exit(Effect.try(() => xs.flatMap(n => xs.map(m => risky(n + m)))))
  if (nested._tag !== "Success") return false
  const mapFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].map(n => risky(n)), catch: (error: unknown) => error }))
  if (mapFailure._tag !== "Failure" || mapFailure.cause.reasons[0]?._tag !== "Fail" || !(mapFailure.cause.reasons[0].error instanceof RangeError)) return false
  const filterFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].filter(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (filterFailure._tag !== "Failure" || filterFailure.cause.reasons[0]?._tag !== "Fail" || !(filterFailure.cause.reasons[0].error instanceof RangeError)) return false
  const flatMapFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].flatMap(n => [risky(n)]), catch: (error: unknown) => error }))
  if (flatMapFailure._tag !== "Failure" || flatMapFailure.cause.reasons[0]?._tag !== "Fail" || !(flatMapFailure.cause.reasons[0].error instanceof RangeError)) return false
  const forEachFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].forEach(n => risky(n)), catch: (error: unknown) => error }))
  if (forEachFailure._tag !== "Failure" || forEachFailure.cause.reasons[0]?._tag !== "Fail" || !(forEachFailure.cause.reasons[0].error instanceof RangeError)) return false
  const reduceFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].reduce((a, n) => a + risky(n), 0), catch: (error: unknown) => error }))
  if (reduceFailure._tag !== "Failure" || reduceFailure.cause.reasons[0]?._tag !== "Fail" || !(reduceFailure.cause.reasons[0].error instanceof RangeError)) return false
  const reduceRightFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].reduceRight((a, n) => a + risky(n), 0), catch: (error: unknown) => error }))
  if (reduceRightFailure._tag !== "Failure" || reduceRightFailure.cause.reasons[0]?._tag !== "Fail" || !(reduceRightFailure.cause.reasons[0].error instanceof RangeError)) return false
  const someFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].some(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (someFailure._tag !== "Failure" || someFailure.cause.reasons[0]?._tag !== "Fail" || !(someFailure.cause.reasons[0].error instanceof RangeError)) return false
  const everyFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].every(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (everyFailure._tag !== "Failure" || everyFailure.cause.reasons[0]?._tag !== "Fail" || !(everyFailure.cause.reasons[0].error instanceof RangeError)) return false
  const findFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].find(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (findFailure._tag !== "Failure" || findFailure.cause.reasons[0]?._tag !== "Fail" || !(findFailure.cause.reasons[0].error instanceof RangeError)) return false
  const findIndexFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].findIndex(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (findIndexFailure._tag !== "Failure" || findIndexFailure.cause.reasons[0]?._tag !== "Fail" || !(findIndexFailure.cause.reasons[0].error instanceof RangeError)) return false
  const findLastFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].findLast(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (findLastFailure._tag !== "Failure" || findLastFailure.cause.reasons[0]?._tag !== "Fail" || !(findLastFailure.cause.reasons[0].error instanceof RangeError)) return false
  const findLastIndexFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].findLastIndex(n => risky(n) > 0), catch: (error: unknown) => error }))
  if (findLastIndexFailure._tag !== "Failure" || findLastIndexFailure.cause.reasons[0]?._tag !== "Fail" || !(findLastIndexFailure.cause.reasons[0].error instanceof RangeError)) return false
  const sortFailure = yield* Effect.exit(Effect.try({ try: () => [...[-1, -2]].sort((a, b) => risky(a) - b), catch: (error: unknown) => error }))
  if (sortFailure._tag !== "Failure" || sortFailure.cause.reasons[0]?._tag !== "Fail" || !(sortFailure.cause.reasons[0].error instanceof RangeError)) return false
  const toSortedFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].toSorted((a, b) => risky(a) - b), catch: (error: unknown) => error }))
  if (toSortedFailure._tag !== "Failure" || toSortedFailure.cause.reasons[0]?._tag !== "Fail" || !(toSortedFailure.cause.reasons[0].error instanceof RangeError)) return false
  const fromFailure = yield* Effect.exit(Effect.try({ try: () => Array.from([-1, -2], n => risky(n)), catch: (error: unknown) => error }))
  if (fromFailure._tag !== "Failure" || fromFailure.cause.reasons[0]?._tag !== "Fail" || !(fromFailure.cause.reasons[0].error instanceof RangeError)) return false
  const flatFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].map(n => [risky(n)]).flat(), catch: (error: unknown) => error }))
  if (flatFailure._tag !== "Failure" || flatFailure.cause.reasons[0]?._tag !== "Fail" || !(flatFailure.cause.reasons[0].error instanceof RangeError)) return false
  const nestedFailure = yield* Effect.exit(Effect.try({ try: () => [-1, -2].flatMap(n => [-1, -2].map(m => risky(n + m))), catch: (error: unknown) => error }))
  if (nestedFailure._tag !== "Failure" || nestedFailure.cause.reasons[0]?._tag !== "Fail" || !(nestedFailure.cause.reasons[0].error instanceof RangeError)) return false
  const failed = yield* Effect.exit(Effect.try({ try: () => [-1].flatMap(n => [risky(n)]), catch: (error: unknown) => error }))
  return failed._tag === "Failure" && failed.cause.reasons[0]?._tag === "Fail" && failed.cause.reasons[0].error instanceof RangeError
 })
}
