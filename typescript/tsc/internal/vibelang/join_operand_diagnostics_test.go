package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestJoinOperandKeepsIndependentDiagnostics(t *testing.T) {
	for _, operation := range []string{"join"} {
		for _, row := range []struct {
			name, decl, operand string
			native              int32
			valid               bool
		}{
			{"argument", "declare function take(n:number):Fiber.Fiber<number>|undefined;", "take(\"bad\")", 2345, false},
			{"nested-argument", "declare function inner(n:number):number;declare function take(n:number):Fiber.Fiber<number>|undefined;", "take(inner(\"bad\"))", 2345, false},
			{"overload", "declare function take(n:number):Fiber.Fiber<number>|undefined;declare function take(n:boolean):Fiber.Fiber<number>|undefined;", "take(\"bad\")", 2769, false},
			{"property", "declare function take(n:{value:number}):Fiber.Fiber<number>|undefined;", "take({value:\"bad\"})", 2322, false},
			{"constraint", "declare function take<T extends number>(n:T):Fiber.Fiber<number>|undefined;", "take<string>(\"bad\")", 2344, false},
			{"satisfies", "declare function take(n:number):Fiber.Fiber<number>|undefined;", "(take(1) satisfies string)", 1360, false},
			{"literal", "", "[1]", 0, false},
			{"literal-argument", "declare function take(n:number):number;", "[take(\"bad\")]", 2345, false},
			{"literal-body", "", "[(() => {const n:number=\"bad\";return n})()]", 2322, false},
			{"assignment", "let target:number;", "(target=\"bad\")", 2322, false},
			{"valid-array", "declare function take(n:number):Fiber.Fiber<number>;", "take(\"bad\")", 2345, true},
			{"plain-rejection", "declare const input:Fiber.Fiber<number>|undefined;", "input", 0, false},
		} {
			t.Run(operation+"/"+row.name, func(t *testing.T) {
				source := row.decl + "\nexport effect function main(){return " + operation + " " + row.operand + "}"
				program, file, _, _ := editorProgram(t, source)
				var got []int32
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						got = append(got, d.Code())
					}
				}
				var want []int32
				if !row.valid {
					want = append(want, 1704)
				}
				if row.native != 0 {
					want = append(want, row.native)
				}
				slices.Sort(got)
				slices.Sort(want)
				if !slices.Equal(got, want) {
					t.Fatalf("want %v got %v\n%s", want, got, source)
				}
			})
		}
	}
}
