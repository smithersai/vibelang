package vibelangfuzz

import (
	"testing"
)

const errorMatcherMigrationQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func TestErrorMatcherMigrationQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", errorMatcherMigrationQuote)
}
