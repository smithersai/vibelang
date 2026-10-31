package vibelangfuzz

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// TestImportedLintCodes holds the compiler's imported lint codes to the
// normative lint-codes.json, which Appendix B's table is generated from: the
// same rules, each under the same code.
func TestImportedLintCodes(t *testing.T) {
	want := ImportedLintCodes()
	if len(want) == 0 {
		t.Fatal("lint-codes.json lists no imported rules")
	}
	if len(core.VibeImportedLintCodes) != len(want) {
		t.Errorf("the compiler assigns %d imported codes, lint-codes.json %d", len(core.VibeImportedLintCodes), len(want))
	}
	for spelled, name := range core.VibeImportedLintCodes {
		code, err := strconv.Atoi(strings.TrimPrefix(spelled, "EK"))
		if err != nil {
			t.Fatalf("%s: %v", spelled, err)
		}
		if want[int32(code)] != name {
			t.Errorf("the compiler gives %s to %s; lint-codes.json gives it to %q", spelled, name, want[int32(code)])
		}
	}
}
