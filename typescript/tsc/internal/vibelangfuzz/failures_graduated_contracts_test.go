package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Keep the original chapter oracle and programs when a completed pending row graduates.
func TestGraduatedFailureContracts(t *testing.T) {
	names := map[string]bool{"direct-local": true, "direct-local-const": true, "direct-local-argument": true, "direct-local-return": true, "effectful-mixed-return": true, "effectful-any-return": true, "effectful-unknown-return": true, "never-return-throw": true, "inferred-callable-alias": true, "generic-unconstrained-substitution": true}
	w := NewWorkspace(t)
	seen := 0
	for _, c := range failuresCases() {
		if !names[c.Name] {
			continue
		}
		seen++
		if !strings.Contains(SpecText(c.chapter()), c.Quote) {
			t.Fatalf("stale quotation for %s", c.Name)
		}
		for _, choice := range []byte{0, 1, 2, 8} {
			t.Run(fmt.Sprintf("%s/%d", c.Name, choice), func(t *testing.T) { checkFailures(t, w, c, choice) })
		}
	}
	if seen != len(names) {
		t.Fatalf("found %d of %d original cases", seen, len(names))
	}
}
