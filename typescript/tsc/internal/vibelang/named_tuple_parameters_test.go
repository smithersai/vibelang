package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNamedTupleParameterLabels(t *testing.T) {
	for _, shape := range []struct{ key, body string }{
		{"optional", "const tuple:[label?:number]=[];"},
		{"assertion", "const tuple=[] as [label?:number];"},
		{"readonly", "const tuple:readonly[label?:number]=[];"},
		{"alias", "type Tuple=[label?:number];const tuple:Tuple=[];"},
		{"same-name", "const tuple:[n?:typeof n]=[];"},
		{"rest", "const tuple:[head:number,...tail:number[]]=[n];"},
		{"generic", "type Tuple<T>=[head:T,...tail:T[]];const tuple:Tuple<number>=[n];"},
		{"callback", "const tuple:[callback?:(n:number)=>number]=[];"},
	} {
		for _, kind := range []string{"declaration", "arrow", "method"} {
			for _, mutates := range []bool{false, true} {
				suffix := ""
				if mutates {
					suffix = "n++;"
				}
				body := "{" + shape.body + suffix + "return n}"
				source := "export effect function read(n:number)" + body
				if kind == "arrow" {
					source = "export const read=effect(n:number)=>" + body
				}
				if kind == "method" {
					source = "export const holder={effect read(n:number)" + body + "}"
				}
				t.Run(shape.key+"/"+kind+"/"+map[bool]string{false: "read", true: "write"}[mutates], func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("unexpected diagnostic: %s", d.String())
						}
					}
					c, done := program.GetTypeCheckerForFile(t.Context(), file)
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
						done()
						t.Fatal("missing source callable")
					}
					got := writesParameters(c, fn)
					done()
					if got != mutates {
						t.Fatalf("runtime parameter write=%t, want %t in %s", got, mutates, source)
					}
					emittedJS(t, program)
				})
			}
		}
	}
}
