package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

func TestTryOperationLiteralContextDiagnostics(t *testing.T) {
	rows := []struct {
		key, operand string
		native       int32
		valid        bool
	}{
		{"property", "({value:\"bad\"} satisfies {value:number})", 2322, false},
		{"excess", "({extra:1} satisfies {value:number})", 2353, false},
		{"array", "([\"bad\"] satisfies number[])", 2322, false},
		{"nested-array", "([{value:\"bad\"}] satisfies {value:number}[])", 2322, false},
		{"tuple", "([\"bad\"] satisfies [number])", 2322, false},
		{"body", "({value:(()=>{const n:number=\"bad\";return n})()} satisfies {value:number})", 2322, false},
		{"raw-property", "({value:1})", 0, false},
		{"valid", "([Effect.succeed(7)] satisfies ReadonlyArray<Effect.Effect<number>>)", 0, true},
	}
	for _, op := range []string{"all", "race", "any", "allSettled"} {
		for _, row := range rows {
			t.Run(op+"/"+row.key, func(t *testing.T) {
				source := "export effect function run(){return try." + op + " " + row.operand + "}"
				program, file, _, _ := editorProgram(t, source)
				got := []int32{}
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					got = append(got, d.Code())
					if d.Code() == 2353 && row.native == 2353 && (!strings.Contains(d.String(), "value") || strings.Contains(d.String(), "ReadonlyArray")) {
						t.Fatalf("lost the written satisfaction target: %s", d.String())
					}
				}
				want := []int32{}
				if !row.valid {
					want = append(want, 1801)
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

// A valid operand domain can still fail the native helper's generic check.
func TestTrySettledTupleOperandMismatch(t *testing.T) {
	source := "declare const values:readonly [Effect.Effect<number>,Effect.Effect<string>];\nexport effect function run(){return try.allSettled values}"
	program, file, _, _ := editorProgram(t, source)
	var got []int32
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			got = append(got, d.Code())
		}
	}
	if len(got) == 0 || slices.ContainsFunc(got, func(code int32) bool { return code != 2345 }) {
		t.Fatalf("want preserved native TS2345 diagnostics got %v", got)
	}
}
