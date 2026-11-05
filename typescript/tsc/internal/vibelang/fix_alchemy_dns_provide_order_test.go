package vibelang

import "testing"

func TestAlchemyDnsProvideConstructionOrder(t *testing.T) {
	assertAlchemyDnsFix(t, `export effect function lookup() {
  return try Effect.provide(effect { return 1 }, Layer.empty)
}
`, "Effect.provide(", "const automatic")
}
