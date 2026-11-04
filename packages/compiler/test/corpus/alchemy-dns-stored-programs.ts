import { Effect } from "effect"
export const trace: string[] = []
export const lookup = Effect.fn(function* (servers: readonly string[], value: string) {
  const queries = servers.map(server => Effect.gen(function* () {
    trace.push(server)
    return server.includes(value)
  }))
  return yield* Effect.all(queries)
})
