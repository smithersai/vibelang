import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let bounds = 0
const limits = { get bound() { bounds++; return 2 } }
const xs: unknown[] = [1,2,3,NaN,{},"1",1n]
const admitted = (s: unknown): s is string | number | bigint => typeof s === "string" || typeof s === "number" || typeof s === "bigint"
return [xs.map(s => [admitted(s) && (s as any) <= limits.bound, admitted(s) && (s as any) >= limits.bound]), bounds]
}) }
