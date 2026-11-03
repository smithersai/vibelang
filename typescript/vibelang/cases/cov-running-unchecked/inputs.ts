import { Effect } from "effect"
/** @throws {never} */
export function inputs(): any[] { return [5, undefined, Promise.resolve(5), [], (function* () { return 7 })(), (function* () { return yield* Effect.succeed(8) })()] }
