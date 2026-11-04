import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
import { join as joinText } from "./strings.js"
export function main() { return Effect.succeed(joinText(["a", "b"])) }
