package lint

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
)

// Alchemy RC6 (drive-alchemy, 2026-11-04): with
// effecttsgo/effect-in-void-success set to error, vibelang lint reported each
// EK4802 twice, as error. EK4802 ports that rule and its severity is
// configurable, so the port was appended again as a configurable code. Each
// diagnostic a file's check reports reaches lint once, at its rule's
// severity; other configurable codes still pass through.
func TestLintReportsAPortOnce(t *testing.T) {
	for _, test := range []struct {
		rule     etscore.Severity
		category diagnostics.Category
	}{
		{etscore.SeverityError, diagnostics.CategoryError},
		{etscore.SeverityWarning, diagnostics.CategoryWarning},
	} {
		port := ast.NewExternalDiagnostic(nil, core.NewTextRange(10, 20), "EK", diagnostics.CategoryWarning, 4802, "ported")
		other := ast.NewExternalDiagnostic(nil, core.NewTextRange(30, 40), "EK", diagnostics.CategoryWarning, 4833, "configurable")
		got := lintPortDiagnostics([]*ast.Diagnostic{port, other}, map[string]etscore.Severity{"effectInVoidSuccess": test.rule})
		counts := map[*ast.Diagnostic]int{}
		for _, d := range got {
			counts[d]++
		}
		if counts[port] != 1 || counts[other] != 1 || len(got) != 2 {
			t.Fatalf("rule %v: port %d, other %d, total %d; want each once", test.rule, counts[port], counts[other], len(got))
		}
		if port.Category() != test.category {
			t.Fatalf("rule %v: port category %v, want %v", test.rule, port.Category(), test.category)
		}
	}
}
