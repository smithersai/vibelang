package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// The checker finds each call's contract by the key of the declaration its
// signature resolves to. Calls in a real program must reach the keys the
// generator wrote, including a method of an exported interface and the
// function a call returns.
func TestEffectThrowsKeysResolve(t *testing.T) {
	source := `import * as SemVer from "effect/SemVer"
export const calls = (raw: unknown, xs: number[]) => [
  Option.some(1),
  pipe(xs, Effect.Array.map((n) => n + 1)),
  Effect.Array.head(xs),
  Schema.decodeUnknownSync(Schema.Number),
  Schema.decodeUnknownSync(Schema.Number)(raw),
  SemVer.parseUnsafe("1.0.0"),
  HashMap.empty<string, number>().pipe(HashMap.set("a", 1)),
]
`
	want := map[string]string{
		"Option.some":              "never",
		"pipe":                     "never",
		"Effect.Array.map":         "never",
		"Effect.Array.head":        "never",
		"Schema.decodeUnknownSync": "never",
		"Schema.decodeUnknownSync(Schema.Number)": "SchemaError",
		"SemVer.parseUnsafe":                      "SemVerError",
		"HashMap.empty":                           "never",
		"HashMap.empty<string, number>().pipe":    "never",
		"HashMap.set":                             "never",
	}
	program, file, _, _ := editorProgram(t, source)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	got := map[string]string{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) {
			callee := file.Text()[scannerSkip(file, n.Expression()):n.Expression().End()]
			if decl := signatureDeclaration(c, n); decl != nil {
				if module, ok := pinnedEffectModule(c, ast.GetSourceFileOfNode(decl)); ok {
					throws, listed := effectThrowsOf(module + ":" + effectKey(decl))
					if !listed {
						throws = "unlisted " + module + ":" + effectKey(decl)
					}
					got[callee] = throws
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	for callee, throws := range want {
		if got[callee] != throws {
			t.Errorf("%s: contract %q, want %q", callee, got[callee], throws)
		}
	}
}

// scannerSkip is the start of n's text, after its leading trivia.
func scannerSkip(file *ast.SourceFile, n *ast.Node) int {
	return nodeStart(file, n)
}
