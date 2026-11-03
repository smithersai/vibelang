import { Effect } from "effect"
/** @throws {never} */
export function initialized(): number { let n: number; const ok = (n = 1, true); return n }
export function main(): Effect.Effect<number> { return Effect.sync(initialized) }
