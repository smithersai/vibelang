package lint

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
)

// A diagnostic that is both a lint port and a configurable compiler warning
// reaches lint once, at the rule's severity. Other configurable codes pass
// through independently.
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
		got := lintPortDiagnostics([]*ast.Diagnostic{port, other}, map[string]etscore.Severity{"returnEffectInGen": test.rule})
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
