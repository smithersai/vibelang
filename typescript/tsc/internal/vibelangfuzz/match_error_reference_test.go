package vibelangfuzz

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestErrorMatcherReferenceQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", "It returns `[subject]` on a match and `false` otherwise")
}

// Check the actual reference printer, including its complete import list.
func TestErrorMatcherReferenceSyntax(t *testing.T) {
	TestErrorMatcherReferenceQuoted(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("node is required to validate the executable matcher reference")
	}
	for _, key := range []string{"vip07.error-matcher-property-plain", "vip07.error-matcher-own-plain"} {
		t.Run(key, func(t *testing.T) {
			reference := vipgen.PrintEffect(vipgen.Probe(key))
			cmd := exec.CommandContext(t.Context(), node, "--input-type=module", "--check")
			cmd.Stdin = strings.NewReader(reference)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("invalid executable reference: %v\n%s", err, output)
			}
		})
	}
}
