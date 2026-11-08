package vibelangfuzz

import (
	"strings"
	"testing"
)

// Predicate narrowing compiles with zero diagnostics and its Exit equals
// the gen twin for throwing and non-throwing predicates.
// Modes 3 to 6 put the predicate in a short-circuit condition. Chapter 7: the
// bridge "replaces narrowed-scope references with an unshadowed `const`", and an
// earlier operand that decides the condition still skips the predicate, so a
// throwing value it skips exits as the twin does.
const foreignPredicateBridgeQuote = "replaces narrowed-scope references with an unshadowed `const`"

func TestForeignPredicateBridgeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), foreignPredicateBridgeQuote) {
		t.Fatal("predicate bridge rule changed")
	}
}
