package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

func TestTryOperationLiteralIndependentDiagnostics(t *testing.T) {
	for _, op := range []string{"all", "race", "any", "allSettled"} {
		for _, row := range []struct {
			name, decl, operand string
			native              int32
		}{
			{"literal-assignment", "let target:number;", "[target=\"bad\"]", 2322},
			{"object", "", "{one:Effect.succeed(1)}", 0},
			{"object-argument", "declare function take(n:number):Effect.Effect<number>;", "{one:take(\"bad\")}", 2345},
			{"object-property", "declare function take(n:{value:number}):number;", "{one:take({value:\"bad\"})}", 2322},
			{"literal-property", "declare function take(n:{value:number}):number;", "[take({value:\"bad\"})]", 2322},
			{"object-assignment", "let target:number;", "{one:(target=\"bad\")}", 2322},
		} {
			t.Run(op+"/"+row.name, func(t *testing.T) {
				source := row.decl + "\nexport effect function main(){return try." + op + " " + row.operand + "}"
				program, file, _, _ := editorProgram(t, source)
				var got []int32
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						got = append(got, d.Code())
						t.Logf("diagnostic %d [%d,%d] %q: %s", d.Code(), d.Pos(), d.End(), source[d.Pos():d.End()], d.String())
					}
				}
				want := []int32{1801}
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
