import { Effect } from "effect"
function load(name: string) { return import(name) }
export function main() { return Effect.gen(function* () {
 const value: typeof import("./native.js") = yield* Effect.tryPromise(() => load("./native.js"))
 return value.value
}) }
