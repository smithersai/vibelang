package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestCatchHeadBoundaryRetainsPropertyNarrowing(t *testing.T) {
	source := `export effect function main(source:{readonly read?:()=>Effect.Effect<number,string>}) {
 if(source.read===undefined)return 0
 return (source.read() catch effect (e)=>throw e) catch ()=>9
 }`
	p, file, _, _ := editorProgram(t, source)
	p.GetSemanticDiagnostics(t.Context(), file)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	var outer *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if outer == nil && catchExpressionOf(n) != nil {
			outer = n
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	if outer == nil {
		t.Fatal("missing catch")
	}
	if rewrite := catchHeadBoundaryRewrite(c, file, outer); rewrite.fixable() {
		t.Fatal("new function loses the property's narrowing")
	}
}
