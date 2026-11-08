package vibelangfuzz

import (
	"strings"
	"testing"
)

const schemaErrorLegacyDefectQuote = "`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads"

func TestSchemaErrorLegacyKeyFixQuoted(t *testing.T) {
	schemaErrorEffectKeysQuoted(t)
	if !strings.Contains(SpecText("003-failures.md"), schemaErrorLegacyDefectQuote) {
		t.Fatalf("003-failures no longer says %q", schemaErrorLegacyDefectQuote)
	}
}
