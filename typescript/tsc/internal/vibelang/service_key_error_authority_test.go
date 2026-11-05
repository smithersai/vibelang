package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceKeyErrorAuthority(t *testing.T) {
	tick := "\x60"
	for _, shape := range []string{"", ": Shape", ": number"} {
		for i, member := range []string{
			"private static readonly key = " + tick + "keys/S" + tick,
			"protected static readonly key = " + tick + "keys/S" + tick,
			"private static key = \"keys/S\"",
			"public static readonly key = 7",
			"protected static readonly key = 7",
			"public static key = \"keys/S\"",
		} {
			t.Run(fmt.Sprintf("%s/%d", shape, i), func(t *testing.T) {
				source := "type Shape = number; export service S" + shape + " { " + member + " }"
				p, file, _, _ := editorProgram(t, source)
				got := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == 901 {
						got++
					} else {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
				}
				if got != 1 {
					t.Fatalf("want one EK0901, got %d", got)
				}
			})
		}
	}
}

func TestServiceKeyErrorAuthorityControls(t *testing.T) {
	for _, source := range []string{
		"export service S: number { static readonly key: string = \"keys/S\" }",
		"export service S { static readonly key: string = \"keys/S\" }",
		"export class Native { private static readonly key = 7; static read() { return this.key } }",
	} {
		for _, d := range errorsOf(t, source) {
			t.Errorf("control: %s", d.String())
		}
	}
}
func TestServiceKeyErrorAuthorityIndependentErrors(t *testing.T) {
	p, file, _, _ := editorProgram(t, "export service S: Missing { private static readonly key = 7 }")
	got := map[int32]int{}
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			got[d.Code()]++
		}
	}
	if len(got) != 2 || got[901] != 1 || got[2304] != 1 {
		t.Fatalf("want EK0901 and independent TS2304, got %v", got)
	}
}
