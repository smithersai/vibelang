import { Effect, Path } from "effect"
function program() { return Effect.gen(function* () {
 const path=yield* Path.Path
 const url=yield* Effect.try(()=>new URL(import.meta.url))
 const file=yield* path.fromFileUrl(url)
 return path.basename(path.dirname(file))
}) }
export function main() { return Effect.provide(program(),Path.layer) }
