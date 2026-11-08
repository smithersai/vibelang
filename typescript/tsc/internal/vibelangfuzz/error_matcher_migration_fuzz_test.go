package vibelangfuzz

import (
	"testing"
)

const errorMatcherMigrationQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestErrorMatcherMigrationQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", errorMatcherMigrationQuote)
}
