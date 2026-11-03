import { Effect } from "effect"
export function main() {
  return Effect.gen(function* () { let x = 6; x ^= 3; return [x, 6 ^ 3, 2 ^ 3] 
  })
}
