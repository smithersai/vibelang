import { Effect, Schema } from "effect"

export const Path = Schema.String.pipe(Schema.brand("Path"))
export type Path = typeof Path.Type

export const cleanup = Effect.fn("cleanup")(function* (files: ReadonlyArray<string>) {
  return files.length
})
export const canonical = Effect.fn("canonical")(function* (input: Path) {
  return input
})
export const explicit = Effect.fnUntraced(function* (files: readonly string[]) {
  return files.length
})

export const optional = Effect.fn(function* (input?: () => number) {
  return input
})
