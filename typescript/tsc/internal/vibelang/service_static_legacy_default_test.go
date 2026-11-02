package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestServiceStaticLegacyDefaultMigration(t *testing.T) {
	for _, rule := range []struct {
		member   string
		rejected bool
		warnings int
	}{
		{`static readonly default = { n: 1 }`, false, 1},
		{`static readonly default: S.Shape = { n: 1 }`, false, 1},
		{`static readonly default: S.Shape`, true, 0},
		{`static readonly defaultValue = () => ({ n: 1 })`, false, 0},
		{`static default = { n: 1 }`, true, 0},
		{`static readonly ["default"] = { n: 1 }`, true, 0},
		{`static default() { return { n: 1 } }`, true, 0},
		{`static readonly extra = { n: 1 }`, true, 0},
	} {
		t.Run(rule.member, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, `export service S { static readonly key = "static/default-migration"; n: number; `+rule.member+` }`)
			rejected, warnings := false, 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4855 {
					warnings++
				}
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 902 {
					rejected = true
				} else {
					t.Errorf("unexpected diagnostic: %s", diagnosticWithNotes(d))
				}
			}
			if rejected != rule.rejected || warnings != rule.warnings {
				t.Fatalf("rejected=%v warnings=%d; want %v %d", rejected, warnings, rule.rejected, rule.warnings)
			}
		})
	}
}
