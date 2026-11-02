package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const unionPlainCallQuote = "A module's top level is ordinary JavaScript (VIP-26)."

func requireUnionPlainCallQuote(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), unionPlainCallQuote) {
		tb.Fatalf("chapter 1 no longer says %q", unionPlainCallQuote)
	}
}

func TestUnionPlainCallsQuoted(t *testing.T) { requireUnionPlainCallQuote(t) }

// These calls pass an Effect-returning value without running it. Cover
// direct, constrained, array and later-inferred arguments from the generator.
func TestUnionDataMemberPlainTypeScript(t *testing.T) {
	requireUnionPlainCallQuote(t)
	w := NewWorkspace(t)
	for _, holder := range []string{"direct", "constrained", "array", "constrained-array", "explicit", "explicit-array", "later", "later-array"} {
		t.Run(holder, func(t *testing.T) {
			CheckUnionDataMember(t, w, parseUnionData([]byte("union-data:plain/plat/"+holder+"/platform-resource")))
		})
	}
}
