import { Effect } from "effect"
export default function (n: number) { return Effect.gen(function* () { return n + 5 }) }
