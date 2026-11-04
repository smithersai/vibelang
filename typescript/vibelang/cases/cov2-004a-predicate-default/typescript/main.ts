import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
function isText(s: string | number): s is string { return typeof s === "string" }
function classify(s: string | number) { if (isText(s)) return s.length; return s.toFixed(0) }
return [classify("abc"),classify(7)]
}) }
