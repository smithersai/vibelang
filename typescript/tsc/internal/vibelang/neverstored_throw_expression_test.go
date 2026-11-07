package vibelang

import (
	"strings"
	"testing"
)

// A throw expression is not a call that runs, so EK1012 never reports one
// stored in a binding, field, element or assignment: VIP-41 writes
// `[a, throw e]` and `f((throw e), b)` as the supported spellings, and its
// Effect TypeScript twin stores no program there. A stored call that never
// succeeds still reports EK1012 at each of the same sites.
func TestNeverStoredSkipsThrowExpressions(t *testing.T) {
	sites := []struct{ name, store string }{
		{"const", "const value = %s; return value"},
		{"let", "let value = %s; return value"},
		{"field", "return { field: %s }"},
		{"first-element", "return [%s, 1]"},
		{"last-element", "return [1, %s]"},
		{"parenthesized-element", "return [(%s), 1]"},
		{"assignment", "let value: number = 0; value = %s; return value"},
	}
	for _, operand := range []struct {
		name, text string
		reported   bool
	}{
		{"throw-new", "throw new Missing({ id: \"a\" })", false},
		{"throw-parenthesized", "throw (new Missing({ id: \"a\" + \"b\" }))", false},
		{"throw-identifier", "throw missing", false},
		{"stored-fail", "try Effect.fail(new Missing({ id: \"a\" }))", true},
	} {
		for _, site := range sites {
			t.Run(operand.name+"/"+site.name, func(t *testing.T) {
				source := "error Missing { id: string }\nconst missing = new Missing({ id: \"m\" })\nexport effect function probe() { " +
					strings.Replace(site.store, "%s", operand.text, 1) + " }\n"
				p, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == EK1012.Code {
						count++
						if !operand.reported {
							t.Errorf("throw expression reported as a stored call: %s", d.String())
						}
					}
				}
				if operand.reported && count != 1 {
					t.Fatalf("want one EK1012 for a stored never-succeeding call, got %d\n%s", count, source)
				}
			})
		}
	}
}
