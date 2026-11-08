package vibelangfuzz

import (
	"strings"
	"testing"
)

func serviceMemberControlRetirementQuoted(t testing.TB) {
	t.Helper()
	const quote = "The first-release retirement diagnostics are `EK3501` for `control` and `handle` syntax"
	if !strings.Contains(SpecText("000-intro.md"), quote) {
		t.Fatalf("retirement rule no longer says %q", quote)
	}
}
func TestServiceMemberControlRetirementQuoted(t *testing.T) { serviceMemberControlRetirementQuoted(t) }
