import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
function classify(s: "a" | "b"): number | string { return s === "a" ? 1 : "b" }
function fail(s: boolean): number { if (s) return 1; throw "bad" }
return [classify("a"),classify("b"),fail(true)]
}) }
