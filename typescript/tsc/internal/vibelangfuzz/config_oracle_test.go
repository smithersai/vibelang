package vibelangfuzz

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// TestConfigOracleMatchesCompiler checks current-spec adjustable assignments
// against compiler configuration admission, with explicit pending debt.
func TestConfigOracleMatchesCompiler(t *testing.T) {
	for _, code := range Facts().Adjustable {
		name := specCodeName(code)
		if _, recorded := Pending("FuzzConfig", "ek:"+name); !core.VibeSeverityCode(name) && !recorded {
			t.Errorf("current specification assigns configurable %s but the compiler rejects it: give FuzzConfig a precise pending line", name)
		}
	}
	// One past the imported table, and an error code, stay out.
	for _, name := range []string{"EK38131", "EK4701"} {
		if core.VibeSeverityCode(name) {
			t.Errorf("the compiler accepts %s, which the specification does not make configurable", name)
		}
	}
}
