import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const regex = /\d/g
const list=Array.from(regex[Symbol.matchAll]("12"))
return [list.map(x=>x[0]),regex.lastIndex,false]
}) }
