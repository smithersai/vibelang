import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
function binding(s:"a"|"b"):string{return s}
function either(s:"a"|"b"):number{return 1}
return [binding("b"),either("a"),either("b")]
}) }
