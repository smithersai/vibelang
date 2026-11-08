package vibelangfuzz

import (
	"strings"
	"testing"
)

const schemaOptionalDefaultQuote = "| `name?: T` / `T?` | `Schema.optional(S)`: missing or present `undefined` | `Schema.optionalKey(S)`: missing only |"

func TestSchemaExactOptionalQuoted(t *testing.T) {
	chapterSays(t, "006-data.md", "| `name?: T \\| undefined` / `(T \\| undefined)?` | `Schema.optional(S)` | `Schema.optional(S)` |")
	chapterSays(t, "003-failures.md", "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |")
	chapterSays(t, "007-tooling.md", "A rewrite that can't preserve types, behavior and declaration output refuses at that site")
	if !strings.Contains(SpecText("006-data.md"), schemaOptionalDefaultQuote) {
		t.Fatalf("006-data.md no longer contains %q", schemaOptionalDefaultQuote)
	}
}
