package vibelangfuzz

import (
	"os"
	"path/filepath"
	"testing"
)

// Three compiler cases carry an inventoried mutable member marker inside a
// typed Effect arrow or beside a try body. The oracle must key each by the
// pending admission:mutable-default gap (VIP-15 adopts no mutable marker),
// not by the callable-kind guess, and report no gap for it.
func TestGrammarAdmissionMutableCases(t *testing.T) {
	w := NewWorkspace(t)
	for _, name := range []string{
		"held-conditional-initializer/main.vibe",
		"plain-structural-bindings.fail/main.vibe",
		"rerun-parameter-readonly/main.vibe",
	} {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("..", "..", "..", "vibelang", "cases", filepath.FromSlash(name)))
			if err != nil {
				t.Fatal(err)
			}
			source := string(data)
			if got := grammarAdmissionForm(source); got != "admission:mutable-default" {
				t.Fatalf("key=%q, want admission:mutable-default", got)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
