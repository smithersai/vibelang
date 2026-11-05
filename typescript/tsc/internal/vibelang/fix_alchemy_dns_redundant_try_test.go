package vibelang

import "testing"

func TestAlchemyDnsRedundantTry(t *testing.T) {
	assertAlchemyDnsFix(t, `effect function resolveTxt(): readonly string[]!! { return ["value"] }
export effect function lookup() { return try resolveTxt() catch () => [] }
`, "return try resolveTxt() catch", "catch")
}
