import { Effect } from "effect"
/** @throws {never} */
export function completedFiber() { return Effect.runFork(Effect.succeed(7)) }
