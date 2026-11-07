import { Effect as Native } from "effect"
interface Effect { readonly "~effect/Effect": Native.Effect<number>["~effect/Effect"] }
/** @throws {never} */
export function copy(): Effect { return Native.succeed(1) }
export function untaggedCopy(): Effect { return Native.succeed(2) }
