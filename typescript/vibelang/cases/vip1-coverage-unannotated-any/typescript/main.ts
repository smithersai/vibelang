import { Effect } from "effect"
function untyped(x: string);
function untyped(x: string) { return Effect.succeed(x) }
type IsAny<T> = 0 extends (1 & T) ? true : false
const anyResult: IsAny<ReturnType<typeof untyped>> = true
export function main(): Effect.Effect<boolean> { return Effect.succeed(anyResult) }
