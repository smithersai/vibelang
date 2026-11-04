package vibelangfuzz

// The existing Chapter 7 migration oracle also covers the DNS module's pure
// dual transforms, arrays of cold programs and provider construction order.
func init() {
	migrationPipeStagePrograms = append(migrationPipeStagePrograms, struct{ key, source string }{"alchemy-dns-stored-programs", `export const trace: string[] = []
export const lookup = Effect.fn(function* (servers: readonly string[], value: string) {
  const queries = servers.map(server => Effect.gen(function* () {
    trace.push(server)
    return server.includes(value)
  }))
  return yield* Effect.all(queries)
})
export const main = () => lookup(["a","b","aa"], "a")
`})
}
