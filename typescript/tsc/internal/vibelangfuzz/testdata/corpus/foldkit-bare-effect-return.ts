import { Effect } from "effect";
export function bare(flag: boolean) { return Effect.gen(function* () { if (flag) return; yield* Effect.void; }); }
