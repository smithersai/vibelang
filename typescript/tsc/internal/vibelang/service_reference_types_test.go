package vibelang

import (
	"strings"
	"testing"
)

func TestReferenceHasNoIdentifierType(t *testing.T) {
	p, file, _, _ := editorProgram(t, `export service Flags { static readonly key = "test/ref"; static readonly defaultValue = () => ({ n: 1 }); n: number }
export let invalid: Flags
export type Imported = import("./main.vibe").Flags
export type ImportedValue = typeof import("./main.vibe").Flags
export let shape: Flags.Shape
export type Key = typeof Flags
service Required { static readonly key = "test/required"; n: number }
export let identifier: Required
`)
	found := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if (d.Code() == 2749 || d.Code() == 2694) && strings.Contains(d.String(), "Flags") {
			found++
			continue
		}
		if d.Category() == 1 {
			t.Fatalf("unexpected diagnostic: %s", d.String())
		}
	}
	if found != 2 {
		t.Fatalf("got %d reference identifier errors; want TS2749 and TS2694", found)
	}
}
