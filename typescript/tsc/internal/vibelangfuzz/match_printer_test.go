package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// The chapter requires the final separator even on generated semantic tests.
func TestDataGeneratedMatchSeparators(t *testing.T) {
	quote := "Separate arms with `;`, including the final arm"
	if !strings.Contains(SpecText("004-match.md"), quote) {
		t.Fatalf("stale generator grammar control: %q", quote)
	}
	arm := &vipgen.Arm{Pattern: &vipgen.Pattern{Tag: "A"}, Value: &vipgen.Num{Value: 1}}
	for _, c := range []struct {
		name     string
		arms     []*vipgen.Arm
		fallback vipgen.Expr
	}{
		{"when", []*vipgen.Arm{arm}, nil},
		{"default", nil, &vipgen.Num{Value: 0}},
		{"when-default", []*vipgen.Arm{arm}, &vipgen.Num{Value: 0}},
		{"multiple-when", []*vipgen.Arm{arm, arm}, nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			var w vipgen.Writer
			m := &vipgen.Match{Subject: &vipgen.Ref{Name: "subject"}, Arms: c.arms, Default: c.fallback}
			m.Vibe(&w)
			source := strings.TrimSpace(w.String())
			if strings.Contains(source, "{ ;") {
				t.Fatalf("generated match begins with a separator instead of an arm: %s", source)
			}
			if !strings.HasSuffix(strings.TrimSpace(strings.TrimSuffix(source, "}")), ";") {
				t.Fatalf("generated final match arm lacks mandatory semicolon: %s", source)
			}
		})
	}
}
