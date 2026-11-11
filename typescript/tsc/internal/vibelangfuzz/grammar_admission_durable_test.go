package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// VIP-55 task and workflow declarations derive through Appendix A's
// TaskDeclaration and WorkflowDeclaration, and the compiler admits them. A
// member outside CallMember and OptionMember still derives, as a
// RejectedElement, and the compiler's EK5501 is a static rejection, so the
// oracle agrees on those shapes too. A line break after the word task leaves
// an identifier, not a declaration start.
func TestGrammarAdmissionDurableDeclarations(t *testing.T) {
	w := NewWorkspace(t)
	admitted := map[string]bool{"task-declaration": true, "task-bodiless-call": true, "workflow-declaration": true, "workflow-export": true}
	seen := 0
	for _, seed := range grammarAdmissionSeeds {
		if !strings.HasPrefix(seed.key, "task-") && !strings.HasPrefix(seed.key, "workflow-") {
			continue
		}
		seen++
		t.Run(seed.key, func(t *testing.T) {
			if admitted[seed.key] {
				result, err := w.Compile(context.Background(), Single(seed.source))
				if err != nil {
					t.Fatal(err)
				}
				for _, d := range result.Diagnostics {
					if grammarAdmissionSyntaxDiagnostic(d) {
						t.Fatalf("admitted durable declaration rejected as syntax: %v", d)
					}
				}
				if grammarAdmissionVerdict(t, w, seed.source) {
					t.Fatal("durable declaration still reported as an admission gap")
				}
			}
			checkGrammarAdmission(t, w, "admission:"+seed.key, seed.source)
		})
	}
	if seen != 7 {
		t.Fatalf("expected 7 task and workflow seeds, found %d", seen)
	}
}
