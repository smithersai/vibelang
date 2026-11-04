package vibelang

import "testing"

func TestAlchemyDnsStoredPrograms(t *testing.T) {
	assertAlchemyDnsFix(t, `effect function resolveTxtAt(server: string): readonly string[]!! { return [server] }
export effect function lookup(servers: readonly string[], value: string) {
  const queries = servers.map(server => Effect.gen(function* () {
    return (yield* resolveTxtAt(server)).includes(value)
  }))
  return try Effect.all(queries)
}
`, "Effect.gen(", "Effect.all")
}
