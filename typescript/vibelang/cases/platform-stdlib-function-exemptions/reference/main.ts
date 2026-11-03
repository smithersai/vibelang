import { Effect } from "effect"
function ordinary() {}
export function main() { return Effect.succeed(ordinary instanceof globalThis.Function) }
