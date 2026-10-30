package vibelangfuzz

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// TestImportedLintCodes holds the compiler's imported lint codes to Appendix
// B's generated table, row by row (VIP-38, decided details 77 and 106).
func TestImportedLintCodes(t *testing.T) {
	want := Facts().Imported
	if len(want) == 0 {
		t.Fatal("Appendix B lists no imported rules")
	}
	if len(core.VibeImportedLintCodes) != len(want) {
		t.Errorf("the compiler assigns %d imported codes, Appendix B %d", len(core.VibeImportedLintCodes), len(want))
	}
	for spelled, name := range core.VibeImportedLintCodes {
		code, err := strconv.Atoi(strings.TrimPrefix(spelled, "EK"))
		if err != nil {
			t.Fatalf("%s: %v", spelled, err)
		}
		if want[int32(code)] != name {
			t.Errorf("the compiler gives %s to %s; Appendix B gives it to %q", spelled, name, want[int32(code)])
		}
	}
}
