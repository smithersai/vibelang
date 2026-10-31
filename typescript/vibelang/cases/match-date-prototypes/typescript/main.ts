import { Effect } from "effect"

export function main(): Effect.Effect<readonly boolean[], never> {
  return Effect.sync((): readonly boolean[] => {
  const subjects: readonly unknown[] = [
    new Date(0), new Date(NaN), Object.create(Date.prototype),
    Object.setPrototypeOf(new Date(0), Object.prototype),
    new Proxy(new Date(0), {}), { [Symbol.toStringTag]: "Date" },
  ]
  const result: boolean[] = []
  for (const value of subjects) {
    result.push(value instanceof Date)
    result.push(value instanceof Date)
  }
  return result
  })
}
