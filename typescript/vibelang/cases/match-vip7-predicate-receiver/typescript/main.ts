import { Effect } from "effect"
const matcher = {
  limit: 2,
  test(value: unknown, hint: { matchType: string }): boolean {
    return hint.matchType === "boolean" && typeof value === "number" && value > this.limit
  }
}
export function recognize(value: unknown): boolean { return matcher.test(value, { matchType: "boolean" }) }
export function main(): Effect.Effect<readonly boolean[]> {
  return Effect.sync(() => [1, 3].map(recognize))
}
