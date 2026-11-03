import { Effect, Console } from "effect"
export let calls=0
export function main() {return Effect.gen(function*(){calls++;yield* Console.log("manual main");return 7})}
