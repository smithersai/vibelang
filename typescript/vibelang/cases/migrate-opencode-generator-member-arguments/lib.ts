import { Effect } from "effect"

export interface Tool {
  readonly arguments: ReadonlyArray<string>
  readonly load: number
}

export const argumentCount = Effect.fnUntraced(function* (tool: Tool) {
  return yield* Effect.succeed(tool.arguments.length)
})

export const firstArgument = Effect.fn("firstArgument")(function* (tool?: Tool) {
  return yield* Effect.succeed(tool?.arguments[0] ?? "none")
})

export const asRecord = Effect.fnUntraced(function* (tool: Tool) {
  return yield* Effect.succeed({ arguments: tool.arguments.length })
})

export const named = (tool: Tool) =>
  Effect.gen(function* load() {
    return yield* Effect.succeed(tool.load)
  })
