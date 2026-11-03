import { Effect } from "effect"
export function main() {
  return Effect.gen(function* () { return [undefined, 3] 
  })
}
