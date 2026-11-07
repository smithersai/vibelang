import { customMatcher } from "vibelang-runtime"
import { Effect } from "effect"
export class One {
  /** @throws {never} */
  static [customMatcher](s: unknown, _options: { matchType: "extractor" }): false | [number] {
    return s === 1 ? [s] : false
  }
}
export function main(): Effect.Effect<unknown> {
  return Effect.sync(() => [One[customMatcher](1, { matchType: "extractor" }) !== false ? "one" : null, One[customMatcher](2, { matchType: "extractor" }) !== false ? "one" : null])
}
