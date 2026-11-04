import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
function empty(x: undefined = undefined) { return Stream.empty as Stream.Stream<number> }
export function main() { return Stream.runCollect(empty()) }
