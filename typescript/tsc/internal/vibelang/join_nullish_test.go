package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestJoinNullishAssignability(t *testing.T) {
	rows := []struct {
		key, declaration, operand string
		nullish                   bool
	}{
		{"null-literal", "", "null", true},
		{"undefined-literal", "", "undefined", true},
		{"void-expression", "", "void 0", true},
		{"null-type", "declare const input:null;", "input", true},
		{"undefined-type", "declare const input:undefined;", "input", true},
		{"null-alias", "type Input=null;declare const input:Input;", "input", true},
		{"undefined-alias", "type Input=undefined;declare const input:Input;", "input", true},
		{"void-type", "declare const input:void;", "input", false},
	}
	for _, row := range rows {
		for _, strict := range []bool{false, true} {
			for wrapper := range 3 {
				t.Run(fmt.Sprintf("%s/strict=%v/wrapper=%d", row.key, strict, wrapper), func(t *testing.T) {
					operand := row.operand
					if wrapper == 1 {
						operand = "(" + operand + ")"
					}
					if wrapper == 2 {
						operand = "(" + operand + " satisfies unknown)"
					}
					source := row.declaration + "\nexport effect function run(){return join " + operand + "}"
					program, file, _, _ := editorProgram(t, source)
					program.Options().StrictNullChecks = core.BoolToTristate(strict)
					got := []int32{}
					for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
						if diagnostic.Category() == diagnostics.CategoryError {
							got = append(got, diagnostic.Code())
						}
					}
					want := []int32{}
					if strict || !row.nullish {
						want = append(want, 1704)
					}
					slices.Sort(got)
					if !slices.Equal(got, want) {
						t.Fatalf("want %v got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}
