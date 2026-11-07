package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestElidedArrayParameters(t *testing.T) {
	for _, shape := range []struct{ key, parameter, value string }{
		{"one", "[,n]:number[]", "n"},
		{"multiple", "[,,n]:number[]", "n"},
		{"only", "[,]:number[]", "0"},
		{"nested", "[[,n]]:number[][]", "n"},
		{"object", "{a:[,n]}:{a:number[]}", "n"},
		{"rest", "[,n,...rest]:number[]", "n"},
		{"trailing", "[,n,]:number[]", "n"},
		{"default", "[,n]:number[]=[1,2]", "n"},
		{"trailing-control", "[n,]:number[]", "n"},
	} {
		for _, kind := range []string{"declaration", "expression", "arrow", "method", "producer", "producer-method"} {
			for _, mutates := range []bool{false, true} {
				if shape.value == "0" && mutates {
					continue
				}
				t.Run(shape.key+"/"+kind+"/"+map[bool]string{false: "read", true: "write"}[mutates], func(t *testing.T) {
					defer func() {
						if value := recover(); value != nil {
							t.Errorf("valid array binding crashed emission: %v", value)
						}
					}()
					body := ""
					if mutates {
						body = "n++;"
					}
					result := "return " + shape.value
					if kind == "producer" || kind == "producer-method" {
						result = "yield " + shape.value
					}
					body = "{" + body + result + "}"
					source := ""
					switch kind {
					case "declaration":
						source = "export effect function read(" + shape.parameter + ")" + body
					case "expression":
						source = "export const read=effect function(" + shape.parameter + ")" + body
					case "arrow":
						source = "export const read=effect(" + shape.parameter + ")=>" + body
					case "method":
						source = "export const holder={effect read(" + shape.parameter + ")" + body + "}"
					case "producer":
						source = "export effect function* read(" + shape.parameter + ")" + body
					case "producer-method":
						source = "export const holder={effect *read(" + shape.parameter + ")" + body + "}"
					}
					program, file, _, _ := editorProgram(t, source)
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("invalid fixture: %s", d.String())
						}
					}
					c, done := program.GetTypeCheckerForFile(t.Context(), file)
					defer done()
					var fn *ast.Node
					var visit func(*ast.Node) bool
					visit = func(n *ast.Node) bool {
						if ast.IsFunctionLike(n) && n.Body() != nil {
							fn = n
							return true
						}
						return n.ForEachChild(visit)
					}
					file.AsNode().ForEachChild(visit)
					if fn == nil {
						t.Fatal("missing callable")
					}
					got := writesParameters(c, fn)
					if got != mutates {
						t.Fatalf("parameter writes=%t want %t", got, mutates)
					}
					emittedJS(t, program)
				})
			}
		}
	}
}
