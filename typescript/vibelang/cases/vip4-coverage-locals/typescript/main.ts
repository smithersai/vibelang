import { Effect } from "effect"
function local(n: number) { return n + 1 }
const arrow = (n: number) => n + 1
const object = { method(n: number) { return n + 1 } }
function factory() { return (n: number) => n + 1 }
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () {
  return [local(1), arrow(2), object.method(3), factory()(4)]
}) }
