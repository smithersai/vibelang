package vibelangfuzz

import (
	"strings"
	"testing"
)

const lintPluginMigrationQuote = "With the entry present, migration is idempotent and reports no `EK3012`."

func TestLintPluginMigrationQuoted(t *testing.T) {
	quote := lintPluginMigrationQuote
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("missing VIP-38 migration oracle %q", quote)
	}
}
