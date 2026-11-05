package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Each rejected member has its own diagnostic; it must not hide a bad key.
func TestServiceKeyWithRejectedMembers(t *testing.T) {
	for _, shape := range []string{"", ": Shape", ": number"} {
		for _, member := range []string{
			"[x: string]: unknown", "constructor() {}", "(): number",
			"get n() { return 1 }", "read() { return 1 }",
		} {
			for i, key := range []string{
				"static key = \"recovery/S\"",
				"static readonly key = 7",
				"static readonly key = \x60recovery/S\x60",
				"static readonly key = \"recovery/S\"",
			} {
				t.Run(fmt.Sprintf("%s/%s/%d", shape, member, i), func(t *testing.T) {
					source := "type Shape = number; export service S" + shape + " { " + key + "; " + member + " }"
					p, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Source() != diagnosticSource {
							t.Errorf("unexpected native diagnostic: %s", d.String())
						}
						got[d.Code()]++
					}
					wantKey := 1
					if i == 3 {
						wantKey = 0
					}
					if got[901] != wantKey || got[902] != 1 || len(got) != 1+wantKey {
						t.Fatalf("want %d EK0901 and one EK0902; got %v: %s", wantKey, got, source)
					}
				})
			}
		}
	}
}

func TestServiceKeyRecoveryControls(t *testing.T) {
	const source = `export class Native {
  static key = 7
  constructor(public n: number) {}
  get value() { return this.n }
 }
 export service Valid { static readonly key = "recovery/Valid"; n: number }
 `
	for _, d := range errorsOf(t, source) {
		t.Errorf("control: %s", d.String())
	}
}

func TestServiceKeyRecoveryKeepsIndependentErrors(t *testing.T) {
	const source = `export service S { static key = "recovery/S"; constructor() {} }
 export const invalid: number = "wrong"
 `
	p, file, _, _ := editorProgram(t, source)
	got := map[int32]int{}
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			got[d.Code()]++
		}
	}
	if len(got) != 3 || got[901] != 1 || got[902] != 1 || got[2322] != 1 {
		t.Fatalf("want EK0901, EK0902 and independent TS2322, got %v", got)
	}
}
