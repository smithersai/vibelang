package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// These reporters remain registered. Their old compiler inputs no longer reach
// them. This checks allocation only; exact test.todo witnesses track emission.
// Each interim row's code, default category and meaning are asserted below; an
// interim code is registered but has no current Appendix B row.
//
// Appendix B: interim EK1013 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#f0248dae34631b27
// Appendix B: interim EK2107 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#3dc5d199659116e9
// Appendix B: interim EK2108 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#7c1a56af271ab999
// Appendix B: interim EK2110 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#965bf23d473bb3a5
// Appendix B: interim EK2119 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#cddd2876eca14b38
// Appendix B: interim EK4201 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#e3bec045e45cfc95
// Appendix B: interim EK4202 registry meaning and default - spec-rule: docs/design/src/900-appendices.md#794af7241a61ecec
func TestAppendixRegisteredOnlyHostExamples(t *testing.T) {
	for _, tc := range []struct {
		code     int32
		category diagnostics.Category
		meaning  string
	}{
		{1013, errorCategory, "are separated by ; or a new line, not by a comma"},
		{2107, errorCategory, "is not a control: a handle clause answers an operation that a control declares"},
		{2108, errorCategory, "has no clause: a handle statement answers every operation of"},
		{2110, errorCategory, "This resume returns what the handle produces next"},
		{2119, errorCategory, "which a resume still waiting in this handle statement then returns"},
		{4201, errorCategory, "is a control operation, and {1} runs it on other fibers"},
		{4202, errorCategory, "is a TypeScript function whose requirements include the control operation"},
		{4406, warningCategory, "will not survive"},
	} {
		m := registry[tc.code]
		if m == nil || m.Category != tc.category || !strings.Contains(m.Text, tc.meaning) {
			t.Fatalf("EK%d: %+v; want %v / %s", tc.code, m, tc.category, tc.meaning)
		}
		if _, current := core.VibeDiagnosticCategories[fmt.Sprintf("EK%04d", tc.code)]; current {
			t.Fatalf("EK%04d is an interim code, not a current Appendix B row", tc.code)
		}
	}
}
