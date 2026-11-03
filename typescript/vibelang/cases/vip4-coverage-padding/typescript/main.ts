import { Effect } from "effect"
export function main() { return Effect.gen(function* () { return ["x".padStart(-1), "x".padEnd(-Infinity), "x".padStart(3,"0"), "x".padEnd(3,"0")] }) }
