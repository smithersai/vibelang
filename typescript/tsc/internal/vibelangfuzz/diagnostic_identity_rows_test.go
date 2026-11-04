package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"slices"
	"testing"
)

// A compatibility inventory must neither enable its dormant ports nor add modern settings.
func TestDiagnosticIdentityInterimDefaults(t *testing.T) {
	facts := Facts()
	for code, want := range map[int32]DefaultCategory{9005: DefaultError, 9006: DefaultError, 9100: DefaultWarning, 9101: DefaultSuggestion, 4803: DefaultWarning, 4805: DefaultWarning, 4811: DefaultOff, 4817: DefaultOff, 4816: DefaultOff, 4818: DefaultOff, 4821: DefaultOff} {
		if !slices.Contains(facts.Interim, code) || facts.Defaults[code] != want {
			t.Fatalf("EK%d: interim=%v default=%v; want %v", code, slices.Contains(facts.Interim, code), facts.Defaults[code], want)
		}
		if _, normal := facts.Rows[code]; normal || slices.Contains(facts.Adjustable, code) {
			t.Fatalf("EK%d compatibility row became a normative/configurable rule", code)
		}
	}
	if _, enabled := core.VibeDiagnosticCategories["EK4818"]; enabled {
		t.Fatal("compatibility inventory changed the compiler configuration registry")
	}
}
