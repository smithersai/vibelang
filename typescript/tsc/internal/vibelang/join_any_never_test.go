package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

func TestJoinAnyNeverAssignability(t *testing.T) {
	rows := []struct {
		key, decl, operand string
		reject             bool
	}{
		{"any", "declare const input:any;", "input", false},
		{"any-alias", "type Input=any;declare const input:Input;", "input", false},
		{"any-union", "declare const input:any|undefined;", "input", false},
		{"never", "declare function impossible():never;", "impossible()", false},
		{"never-alias", "type Empty=never;declare function impossible():Empty;", "impossible()", false},
		{"never-generic", "type Empty<T>=T&never;declare function impossible():Empty<number>;", "impossible()", false},
		{"fiber", "declare const input:Fiber.Fiber<number>;", "input", false},
		{"unknown", "declare const input:unknown;", "input", true},
		{"number", "declare const input:number;", "input", true},
	}
	for _, row := range rows {
		for wrapper := 0; wrapper < 3; wrapper++ {
			t.Run(row.key+"/"+string(rune('0'+wrapper)), func(t *testing.T) {
				operand := row.operand
				if wrapper == 1 {
					operand = "(" + operand + ")"
				} else if wrapper == 2 {
					operand = "(" + operand + " satisfies unknown)"
				}
				source := row.decl + "\nexport effect function run(){return join " + operand + "}"
				program, file, _, _ := editorProgram(t, source)
				got := []int32{}
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						got = append(got, d.Code())
					}
				}
				want := []int32{}
				if row.reject {
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
