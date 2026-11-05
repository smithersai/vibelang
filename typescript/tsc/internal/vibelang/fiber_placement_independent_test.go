package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestFiberPlacementKeepsIndependentDiagnostics(t *testing.T) {
	boundaries := []struct{ name, source string }{
		{"plain", "function run(){return %s}"},
		{"async", "async function run(){return %s}"},
		{"effect-default", "effect function run(x = %s){return 1}"},
		{"effect-static", "effect function run(){class C {static {const value = %s}}return 1}"},
	}
	rows := []struct {
		name, decl, operand string
		code                int32
	}{
		{"argument", "declare function take(n:number):number;", "take(\"bad\")", 2345},
		{"nested-argument", "declare function inner(n:number):number;declare function take(n:number):number;", "take(inner(\"bad\"))", 2345},
		{"overload", "declare function take(n:number):number;declare function take(n:boolean):number;", "take(\"bad\")", 2769},
		{"constraint", "declare function take<T extends number>(n:T):number;", "take<string>(\"bad\")", 2344},
		{"property", "declare function take(n:{value:number}):number;", "take({value:\"bad\"})", 2322},
		{"valid", "declare function take(n:number):number;", "take(1)", 0},
	}
	for _, op := range []string{"fork", "join"} {
		for _, boundary := range boundaries {
			for _, row := range rows {
				t.Run(op+"/"+boundary.name+"/"+row.name, func(t *testing.T) {
					source := row.decl + "\n" + fmt.Sprintf(boundary.source, op+" "+row.operand)
					program, file, _, _ := editorProgram(t, source)
					got := []int32{}
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							got = append(got, d.Code())
						}
					}
					want := []int32{1701}
					if row.code != 0 {
						want = append(want, row.code)
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
}
