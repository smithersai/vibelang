import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
const trace: string[] = []
const y = "outer"
function ordinary(a: number | undefined = undefined, b: number | undefined = undefined) { if (a === undefined) { trace.push("a"); return 7 }; if (b === undefined) { trace.push("b"); b = 2 }; trace.push("body"); return 0 }
function scoped(a: number | undefined = undefined, b = () => y) { if (a === undefined) return 0; const y = "body"; return b() }
const literal = (a: number | undefined = undefined): 1 | "early" => a === undefined ? "early" : 1
const earlyType: 1 | "early" = literal()
export function main() { return Effect.gen(function* () {
 const result = ordinary()
 return { result, trace, length: ordinary.length, outer: scoped(1), early: scoped(), earlyType }
}) }
