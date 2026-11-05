package vibelangmapper

import (
	"fmt"
	"strings"
	"testing"
)

// Explicit file names keep existing expectations on the same module when a
// documentation page gains an earlier block. Unlisted cases retain their
// ordinal identity, so new disagreements still fail the normal comparison.
func docsFormCaseName(name, file string) string {
	page, _, ok := strings.Cut(name, "#block-")
	if ok {
		stable := page + "#file:" + file
		if _, listed := formChoiceAhead[stable]; listed {
			return stable
		}
	}
	return name
}

func FuzzDocsFormCaseIdentity(f *testing.F) {
	for _, ordinal := range []uint8{0, 8, 9, 10, 127, 255} {
		f.Add(ordinal)
	}
	f.Fuzz(func(t *testing.T, ordinal uint8) {
		page := "docs/user/src/vibelang-features/118-experimental-platform-apis.md"
		name := fmt.Sprintf("%s#block-%d", page, int(ordinal)+1)
		if got := docsFormCaseName(name, "serve.vibe"); got != page+"#file:serve.vibe" {
			t.Fatalf("named module lost its expectation after a block insertion: %s", got)
		}
		if got := docsFormCaseName(name, "another.vibe"); got != name {
			t.Fatalf("unlisted module acquired an existing expectation: %s", got)
		}
		otherPage := fmt.Sprintf("other.md#block-%d", int(ordinal)+1)
		if got := docsFormCaseName(otherPage, "serve.vibe"); got != otherPage {
			t.Fatalf("another page acquired an existing expectation: %s", got)
		}
	})
}
