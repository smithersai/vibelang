package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// rule-evidence: docs/design/vips/0021-producers.md#decision | The old `EK2101` is retired and will never be reassigned.
// TestRetiredEK2101Unassigned proves that no active table assigns the retired
// code: not the checker registry, Appendix B's categories, the imported lint
// codes or the mapper's own codes. witness07-vip21-retired-ek2101-config.fail
// is the configuration control: vibe.severities refuses it as EK3006, as it
// refuses a never-assigned code.
func TestRetiredEK2101Unassigned(t *testing.T) {
	t.Parallel()
	if m := registry[2101]; m != nil {
		t.Errorf("the checker registry assigns retired EK2101: %q", m.Text)
	}
	if category, ok := core.VibeDiagnosticCategories["EK2101"]; ok {
		t.Errorf("Appendix B categories assign retired EK2101 as %q", category)
	}
	if category, ok := core.VibeImportedLintCodes["EK2101"]; ok {
		t.Errorf("imported lint codes assign retired EK2101 as %q", category)
	}
	for _, code := range []int32{vibelangmapper.CodeUnprojectedForm, vibelangmapper.CodeExecSyntax,
		vibelangmapper.CodeInvalidOption, vibelangmapper.CodeVersionMismatch,
		vibelangmapper.CodeFormChoice, vibelangmapper.CodeDataMethod} {
		if code == 2101 {
			t.Error("a mapper code reuses retired EK2101")
		}
	}
	// Control: the code that replaced it is active.
	if registry[2128] == nil && core.VibeDiagnosticCategories["EK2128"] == "" {
		t.Error("EK2128, the producer-return code, is not registered")
	}
}
