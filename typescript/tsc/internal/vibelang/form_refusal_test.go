package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Public diagnostics keep their eligibility, but no longer expose quick-fix
// notes (Chapter 7, Explicit source changes). Check the retained analysis
// directly so a warning alone cannot masquerade as a reasoned refusal.
func assertFormRefusal(t *testing.T, source string, code int32, why string) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("invalid refusal fixture: %s", d.String())
		}
	}
	var found *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == code {
			if found != nil {
				t.Fatalf("multiple EK%04d diagnostics in %s", code, source)
			}
			found = d
		}
	}
	if found == nil {
		t.Fatalf("missing EK%04d in %s", code, source)
	}
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	rule := tsFormRules[code]
	if rule == nil {
		t.Fatalf("missing analysis rule for EK%04d", code)
	}
	count := 0
	rule.find(c, file, func(at *ast.Node, rewrite *formRewrite, _ ...any) {
		if tsFormSpan(file, at).Pos() != found.Pos() {
			return
		}
		count++
		rewrite = preserveRewriteComments(file, rewrite)
		if rewrite == nil || rewrite.fixable() {
			t.Fatalf("EK%04d did not retain a refusal: %+v", code, rewrite)
		}
		if !strings.Contains(rewrite.why, why) {
			t.Errorf("refusal %q lacks %q", rewrite.why, why)
		}
	})
	if count != 1 {
		t.Fatalf("found %d refusal analyses for EK%04d, want 1", count, code)
	}
}
