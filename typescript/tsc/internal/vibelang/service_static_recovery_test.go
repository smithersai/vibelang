package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceRejectedImplementationKeepsStaticErrors(t *testing.T) {
	instances := []string{"run(): void {}", "n = 1", "get n(): number { return 1 }", "set n(value: number) {}", "[Symbol.iterator](): Iterator<number> { return [1][Symbol.iterator]() }"}
	statics := []string{"static helper = 1", "static readonly helper = 1", "static helper(): void {}", "static get helper(): number { return 1 }"}
	for i, instance := range instances {
		for j, static := range statics {
			for _, reverse := range []bool{false, true} {
				t.Run(fmt.Sprintf("instance%d/static%d/reverse%v", i, j, reverse), func(t *testing.T) {
					members := instance + "; " + static
					if reverse {
						members = static + "; " + instance
					}
					source := "export service S { static readonly key = \"static/S\"; " + members + " }"
					p, file, _, _ := editorProgram(t, source)
					count := 0
					ds := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
					for _, d := range ds {
						if d.Source() == diagnosticSource && d.Code() == 902 {
							count++
						} else if d.Category() == diagnostics.CategoryError {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					if count != 2 {
						t.Fatalf("want EK0902 for each rejected member, got %d", count)
					}
				})
			}
		}
	}
}

func TestServiceStaticRecoveryKeepsIndependentErrors(t *testing.T) {
	for _, tc := range []struct {
		member string
		native bool
	}{
		{"static helper = missing", true},
		{"static helper", false},
		{"static helper(): void", false},
	} {
		t.Run(tc.member, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, "export service S { static readonly key = \"static/S\"; run(): void {}; "+tc.member+" }")
			count, native := 0, 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				switch {
				case d.Source() == diagnosticSource && d.Code() == 902:
					count++
				case d.Code() == 2304:
					native++
				case d.Category() == diagnostics.CategoryError:
					t.Errorf("unexpected: %s", d.String())
				}
			}
			wantNative := 0
			if tc.native {
				wantNative = 1
			}
			if count != 2 || native != wantNative {
				t.Fatalf("want 2 EK0902 and %d TS2304, got %d and %d", wantNative, count, native)
			}
		})
	}
}
