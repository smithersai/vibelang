import { Effect } from "effect";
export function main() { return Effect.gen(function* () { Effect.succeed(1); Effect.gen(function* () { return 99 }); return 2 }) }
