package vibelangfuzz

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// TestImportedLintCodes holds the compiler's imported lint codes to Appendix
// B's allocation (decided detail 106), which ImportedLintCodes derives, and
// checks that the appendix still states that allocation.
func TestImportedLintCodes(t *testing.T) {
	appendix := SpecText(grammarAppendix)
	for _, quote := range []string{
		"`EK3801` `floatingEffect` is the retained first assignment",
		"The other rules take ordinals 2 onward in ascending ASCII order of their rule names",
		"An ordinal past 99 extends the code: `EK3899`, then `EK38100`.",
	} {
		if !strings.Contains(appendix, quote) {
			t.Errorf("Appendix B no longer says %q", quote)
		}
	}
	want := ImportedLintCodes()
	if len(core.VibeImportedLintCodes) != len(want) {
		t.Fatalf("the compiler assigns %d imported codes, the allocation %d", len(core.VibeImportedLintCodes), len(want))
	}
	for spelled, name := range core.VibeImportedLintCodes {
		code, err := strconv.Atoi(strings.TrimPrefix(spelled, "EK"))
		if err != nil {
			t.Fatalf("%s: %v", spelled, err)
		}
		if want[int32(code)] != name {
			t.Errorf("the compiler gives %s to %s; Appendix B's allocation gives it to %s", spelled, name, want[int32(code)])
		}
	}
	if Facts().IsRegistered(38100) != (len(want) >= 100) {
		t.Errorf("IsRegistered(38100) disagrees with an allocation of %d codes", len(want))
	}
}
