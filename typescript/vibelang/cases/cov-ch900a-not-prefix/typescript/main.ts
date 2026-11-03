import { Effect } from "effect"
const not = (_x: unknown) => true
function classify(x: number) { return x !== 1 ? "other" : "one" }
export function main() {
  return Effect.gen(function* () { return [classify(1), classify(2)] 
  })
}
