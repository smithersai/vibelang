import { Effect } from "effect"
declare namespace Native { function count(): number }
declare function load(): number
const value: ReturnType<typeof load> = 1
export function main() {
  return Effect.gen(function* () { return value 
  })
}
