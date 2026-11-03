package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

const tryAssignmentCallbackHeader = "import * as Effect from \"effect/Effect\";\ninterface Item {readonly id:string}\ntype Err={readonly _tag:\"Conflict\"}|{readonly _tag:\"Other\"};\ndeclare const create:()=>Effect.Effect<Item,Err>;\ndeclare const update:()=>Effect.Effect<Item,Err>;\ndeclare const fallback:()=>Effect.Effect<Item,Err>;\ndeclare const maybe:()=>Effect.Effect<Item|undefined,Err>;\n"

func TestTryAssignmentEffectCallbacks(t *testing.T) {
	for _, tc := range []struct {
		name, expression string
		nullable         bool
	}{
		{"direct", "try create()", false},
		{"callback-reference", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",fallback)", false},
		{"plain-callback", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",()=>update())", false},
		{"effect-arrow", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",effect ()=>try update())", false},
		{"effect-block", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",effect ()=>{return try update()})", false},
		{"effect-function", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",effect function(){return try update()})", false},
		{"nullable-callback", "try Effect.catchIf(create(),(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\",effect ()=>try maybe())", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tryAssignmentCallbackHeader + "export effect function caught(observed:Item|undefined){let current=observed;if(current===undefined){current=" + tc.expression + ";return current.id}return current.id}"
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() != diagnosticSource && d.Code() == 18048 {
					found = true
					if tc.nullable {
						continue
					}
				}
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
			if found != tc.nullable {
				t.Errorf("TS18048=%v, want %v", found, tc.nullable)
			}
			if t.Failed() {
				c, done := p.GetTypeCheckerForFile(t.Context(), file)
				defer done()
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if ast.IsCallExpression(n) && ast.IsPropertyAccessExpression(n.Expression()) && n.Expression().Name().Text() == "catchIf" {
						sig := c.GetResolvedSignature(n)
						for i, argument := range c.GetTypeArgumentsForResolvedSignature(sig) {
							t.Logf("catchIf type argument[%d]: %s", i, c.TypeToString(argument))
						}
					}

					if ast.IsBinaryExpression(n) && n.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken && ast.IsIdentifier(n.AsBinaryExpression().Left) && n.AsBinaryExpression().Left.Text() == "current" {
						t.Logf("assignment RHS type: %s", c.TypeToString(c.GetTypeAtLocation(n.AsBinaryExpression().Right)))
					}
					if ast.IsPropertyAccessExpression(n) && n.Name() != nil && n.Name().Text() == "id" {
						t.Logf("id receiver type: %s", c.TypeToString(c.GetTypeAtLocation(n.Expression())))
					}
					return n.ForEachChild(visit)
				}
				file.AsNode().ForEachChild(visit)
			}
		})
	}
}
