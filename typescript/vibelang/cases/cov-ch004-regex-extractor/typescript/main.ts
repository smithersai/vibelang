import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
function digits(s: string) { const re=/(\d+)-(\d+)/; const m=re[Symbol.match](s); return m === null ? "none" : m[1]+m[2] }
return [digits("12-34"),digits("no"),/\d+/.test("12"),/\d+/.test("no")]
}) }
