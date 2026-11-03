import { Effect } from "effect"
let defaults=0,bodies=0
export function cold(n=++defaults) { return Effect.gen(function*(){bodies++;return n}) }
export function main() { return Effect.gen(function*(){const p=cold();const before=[defaults,bodies];return [before,yield* p,yield* p,defaults,bodies]}) }
