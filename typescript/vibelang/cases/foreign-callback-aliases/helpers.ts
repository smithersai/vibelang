import { Effect } from "effect"
/** @throws {Error} */
export function risky(): number { throw new Error("risky") }
/** @throws {never} */
export function safe(): number { return 1 }
export interface Throwing {
  /** @throws {unknown} */
  (): number
}
/** @throws {never} */
export function allow(f: Throwing) { return f }
/** @throws {Error} */
export function program(): Effect.Effect<number> { return Effect.succeed(3) }
