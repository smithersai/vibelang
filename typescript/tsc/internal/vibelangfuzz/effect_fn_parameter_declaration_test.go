package vibelangfuzz

import (
	"strings"
	"testing"
)

const effectFnParameterDeclarationTarget = "FuzzEffectFnParameterDeclaration"

// Unannotated generator parameters, which Effect.fn's inferred tuple types as
// any: defaults of each literal kind, after an annotated parameter, in a
// generic generator (not contextual), bare and optional, and before a stage.
var effectFnContextualParameterKeys = []string{"default-string", "default-number", "default-object", "default-after-annotated", "default-generic", "bare", "bare-optional", "bare-staged", "default-staged"}

func TestEffectFnParameterDeclarationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
	if !strings.Contains(SpecText("001-functions.md"), migrationDefaultProgramQuote) {
		t.Fatalf("Chapter 1 no longer says %q", migrationDefaultProgramQuote)
	}
	const identity = "each export's type identical to `tsc`'s in both directions"
	if !strings.Contains(SpecText("001-functions.md"), identity) {
		t.Fatalf("Chapter 1 no longer says %q", identity)
	}
}
