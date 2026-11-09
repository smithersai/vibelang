package vibelangfuzz

import (
	"strings"
	"testing"
)

func retainedErrorMigrationQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("004-match.md")
	if !strings.Contains(SpecText("007-tooling.md"), "types, comments and declaration output") {
		t.Fatal("missing refactor declaration oracle")
	}
	for _, quote := range []string{"any extractor is `EK0704`", "call-only predicate", "declared return iterable"} {
		if !strings.Contains(text, quote) {
			t.Fatalf("missing migration oracle: %s", quote)
		}
	}
}

func TestRetainedErrorMigrationQuoted(t *testing.T) { retainedErrorMigrationQuoted(t) }
