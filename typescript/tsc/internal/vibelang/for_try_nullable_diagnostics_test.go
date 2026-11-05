package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

func TestForTryNullableKeepsIndependentDiagnostics(t *testing.T) {
	for _, row := range []struct {
		name, decl, operand, body string
		want                      []int32
	}{
		{"undefined", "declare const p:Stream.Stream<number>|undefined;", "p", "void value", []int32{2004}},
		{"null", "declare const p:Stream.Stream<number>|null;", "p", "void value", []int32{2004}},
		{"both", "declare const p:Stream.Stream<number>|null|undefined;", "p", "void value", []int32{2004}},
		{"parenthesized", "declare const p:Stream.Stream<number>|undefined;", "(p)", "void value", []int32{2004}},
		{"satisfies", "declare const p:Stream.Stream<number>|undefined;", "(p satisfies Stream.Stream<number>|undefined)", "void value", []int32{2004}},
		{"optional-call", "declare const p:(()=>Stream.Stream<number>)|undefined;", "p?.()", "void value", []int32{2004}},
		{"body", "declare const p:Stream.Stream<number>|undefined;", "p", "const n:number=\"bad\";void n", []int32{2004, 2322}},
		{"argument", "declare function p(n:number):Stream.Stream<number>|undefined;", "p(\"bad\")", "void value", []int32{2004, 2345}},
		{"property-argument", "declare function p(n:{value:number}):Stream.Stream<number>|undefined;", "p({value:\"bad\"})", "void value", []int32{2004, 2322}},
		{"receiver-and-stream", "declare const obj:{stream?:Stream.Stream<number>}|undefined;", "obj.stream", "void value", []int32{2004, 18048}},
		{"receiver-only", "declare const obj:{stream:Stream.Stream<number>}|undefined;", "obj.stream", "void value", []int32{18048}},
		{"nested-argument", "declare function inner(n:number):number;declare function p(n:number):Stream.Stream<number>|undefined;", "p(inner(\"bad\"))", "void value", []int32{2004, 2345}},
		{"satisfaction-error", "declare const p:Stream.Stream<number>|undefined;", "(p satisfies number)", "void value", []int32{1360, 2004}},
		{"nonnull", "declare const p:Stream.Stream<number>|undefined;", "p!", "void value", nil},
		{"assignment", "let target:Stream.Stream<number>|undefined;", "(target=\"bad\")", "void value", []int32{2004, 2322}},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := row.decl + "\nexport effect function main(){for try(const value of " + row.operand + "){" + row.body + "};return 0}"
			program, file, _, _ := editorProgram(t, source)
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			want := slices.Clone(row.want)
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Fatalf("want %v got %v\n%s", want, got, source)
			}
		})
	}
}
