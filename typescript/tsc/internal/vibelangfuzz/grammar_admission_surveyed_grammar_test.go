package vibelangfuzz

import (
	"context"
	"testing"
)

// Statement and call forms the compiler cases exposed as underived: an
// `await using` declaration (a line break may separate `await` from `using`,
// as the cover grammar reads an await expression first; the bindings follow
// `using` on its line) and `using` heads of a for statement (explicit
// resource management, inherited from TypeScript), a tagged template on a
// call chain, and an instantiation expression on a call result ended by a
// line break or a semicolon. The compiler admits each.
var grammarSurveyedStatementSeeds = map[string]bool{
	"await-using-statement":             true,
	"await-using-line-break":            true,
	"for-using-head":                    true,
	"for-await-using-head":              true,
	"tagged-template-call-chain":        true,
	"instantiation-call-newline-export": true,
	"instantiation-call-semicolon":      true,
}

func TestGrammarAdmissionSurveyedStatements(t *testing.T) {
	w := NewWorkspace(t)
	seen := 0
	for _, seed := range grammarAdmissionSeeds {
		if !grammarSurveyedStatementSeeds[seed.key] {
			continue
		}
		seen++
		t.Run(seed.key, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(seed.source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("admitted form rejected as syntax: %v", d)
				}
			}
			if grammarAdmissionVerdict(t, w, seed.source) {
				t.Fatal("inherited form still reported as an admission gap")
			}
			checkGrammarAdmission(t, w, "admission:"+seed.key, seed.source)
		})
	}
	if seen != len(grammarSurveyedStatementSeeds) {
		t.Fatalf("expected %d statement seeds, found %d", len(grammarSurveyedStatementSeeds), seen)
	}
}
