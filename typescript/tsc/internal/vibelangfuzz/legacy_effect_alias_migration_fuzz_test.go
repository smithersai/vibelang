package vibelangfuzz

import (
	"strings"
	"testing"
)

const legacyEffectAliasQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestLegacyEffectAliasMigrationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyAliasQuote) {
		t.Fatalf("missing legacy binding rule %q", legacyAliasQuote)
	}
	if !strings.Contains(SpecText("007-tooling.md"), legacyEffectAliasQuote) {
		t.Fatalf("missing migration rule %q", legacyEffectAliasQuote)
	}
}

func legacyMigrationDeclarationBytes(result *Result) map[string]string {
	declarations := make(map[string]string)
	for name, text := range result.Outputs {
		if isDeclaration(name) {
			declarations[name] = text
		}
	}
	return declarations
}
