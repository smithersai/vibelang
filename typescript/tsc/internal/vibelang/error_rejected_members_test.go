package vibelang

import (
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorRejectedMemberKeepsTypeScriptErrorsOutside(t *testing.T) {
	// Dropping a rejected member's TypeScript errors does not hide errors elsewhere in the body.
	program, file, _, _ := editorProgram(t, "error E { id = 1; get value(): number { return \"x\" } }")
	var codes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Source()+strconv.Itoa(int(d.Code())))
		}
	}
	if len(codes) != 2 || codes[0] != "EK1304" && codes[1] != "EK1304" {
		t.Fatalf("got %v, want EK1304 and the getter's TS2322", codes)
	}
}

func TestErrorRejectedMembersExclusions(t *testing.T) {
	for _, source := range []string{
		"error E { id: string; readonly n: number; optional?: string; private m() { return 1 }; get value() { return this.id } }",
		"schema error E { id: string; readonly n: number; optional?: string; private m() { return 1 }; get value() { return this.id } }",
		"class E { id = 1; private value?: string }",
		"error E { static id = 1; set value(x: string) {} }",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 1304 {
				t.Errorf("unexpected EK1304: %s", source)
			}
		}
	}
}

func TestErrorMemberFirstMatchingRule(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		program, file, _, _ := editorProgram(t, form+" E { static set value(x: string) {} }")
		count := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 1302 || d.Code() == 1304 {
				count++
			}
		}
		if count != 1 {
			t.Errorf("got %d diagnostics for one static setter", count)
		}
	}
}
