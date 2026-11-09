package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// TestDataDefaultRejected pins EK2803 to each defaulted data type parameter and
// admits the same default on a type alias of an undefaulted data type.
func TestDataDefaultRejected(t *testing.T) {
	source := "data Box<A = string> { Value { value: A } }\n" +
		"data Pair<A, B = number> { Value { first: A; second: B } }\n" +
		"data Plain<A> { Value { value: A } }\n" +
		"type PlainOf<A = string> = Plain<A>\n" +
		"export const plain: PlainOf = Plain.Value({ value: \"text\" })\n"
	program, file, _, _ := editorProgram(t, source)
	var got []int
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Source() != "EK" || d.Code() != EK2803.Code {
			t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
			continue
		}
		got = append(got, d.Pos())
	}
	want := []int{strings.Index(source, "string> {"), strings.Index(source, "number>")}
	// rule-evidence: docs/design/vips/0028-generic-data.md#f5c8ea5db0d4a804 | **Amended 2026-10-29: no defaults.** A default on a generic `data` type parameter (`data Box<A = string>`) is a compile error, as a constraint is.
	if !slices.Equal(got, want) {
		t.Fatalf("EK2803 at %v, want %v (Box's A and Pair's B; none on the PlainOf alias)", got, want)
	}
}
