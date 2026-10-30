package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestDataDefaultMigration(t *testing.T) {
	for _, source := range []string{
		"data Box<A = string> { Value { value: A } }\nconst value: Box = Box.Value({ value: \"yes\" })\n",
		"export data Pair<A = string, B = A> { Value { first: A; second: B } }\nconst value: Pair = Pair.Value({ first: \"yes\", second: \"yes\" })\n",
		"const Data = 0; const $Data = 1\ndata Box<A = string> { Value { value: A } }\nconst value: Box = Box.Value({ value: \"yes\" })\n",
		"const $D\\u0061ta = 7\ndata Box<A = string> { Value { value: A } }\nconst value: Box = Box.Value({ value: \"yes\" })\n",
		"data Box<A = string> { Value { value: A } }\nexport effect function build(): Box!never { return Box.Value({value:\"yes\"}) }\n",
	} {
		got := applyQuickFixOf(t, source, EK2803.Code, diagnostics.CategoryError)
		if got == source || !strings.Contains(got, " = string>") && !strings.Contains(got, " = string, B = A>") {
			t.Fatalf("default not preserved on an alias:\n%s", got)
		}
		program, file, _, _ := editorProgram(t, got)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("migrated source reports %s%d: %s\n%s", d.Source(), d.Code(), d.String(), got)
			}
		}
	}
}
