import { Effect } from "effect"
function read(provide: number[]) {
  provide[0]
  {}
  provide
  [0]
  {}
  const value = provide[0] - 1
  return value
}
function call(provide: (n: number) => number) { return provide(2) }
export function main() {
  return Effect.gen(function* () { return [read([3]), call(n => n + 1)] 
  })
}
