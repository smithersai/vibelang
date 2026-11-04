import { Effect } from "effect"
function isOne(s: unknown): s is 1 { return s === 1 }
function label(s: 1 | 2) {
  if (isOne(s)) { const value: 1 = s; return `one ${value}` }
  const value: 2 = s
  return `two ${value}`
}
export function main() { return Effect.gen(function* () { return [label(1), label(2), isOne(1), isOne(2)] }) }
