import { Effect } from "effect"
class Point {}
export function main() { return Effect.gen(function* () {
  const effect: unknown = new Point()
  const async = 3
  let hits = 0
  effect instanceof Point && (hits += 1)
  async < 5 && (hits += 1)
  return hits
}) }
