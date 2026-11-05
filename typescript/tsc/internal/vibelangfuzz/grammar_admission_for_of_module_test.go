package vibelangfuzz

import (
	"context"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Parser records select a known pending key only; the independent grammar
// and full diagnostic check still decide whether this is an admission gap.
func grammarForOfAsyncModule(file *ast.SourceFile, source string) bool {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n == nil {
			return false
		}
		if ast.IsFunctionLike(n) {
			if n.Flags&ast.NodeFlagsVibeLangEffect != 0 || n.Kind != ast.KindArrowFunction || n.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed == 0 {
				return false
			}
		}
		switch n.Kind {
		case ast.KindClassDeclaration, ast.KindClassExpression, ast.KindModuleDeclaration:
			return false
		case ast.KindForOfStatement:
			loop := n.AsForInOrOfStatement()
			if loop.AwaitModifier == nil && ast.IsIdentifier(loop.Initializer) && loop.Initializer.Text() == "async" && n.Pos() >= 0 && loop.Initializer.End() <= len(source) {
				head := grammarLexSource(source[n.Pos():loop.Initializer.End()])
				if len(head) >= 3 && head[0].text == "for" && head[1].text == "(" {
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(file.AsNode())
}

func TestGrammarAdmissionForOfAsyncModuleKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"for (async of xs) {}":                          true,
		"for\n(async\nof xs) {}":                        true,
		"{ for (async of xs) {} }":                      true,
		"let async; for (async of xs) {}":               true,
		"function f(xs) { for (async of xs) {} }":       false,
		"async function f(xs) { for (async of xs) {} }": false,
		"for await (async of xs) {}":                    false,
		"for (const async of xs) {}":                    false,
		"for ((async) of xs) {}":                        false,
		"for (obj.async of xs) {}":                      false,
		"for (async in xs) {}":                          false,
		"class C { m(xs) { for (async of xs) {} } }":    false,
		"const text = \"for (async of xs) {}\";":        false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:for-of-async-module") != want {
			t.Errorf("key=%q, want module async head=%v: %s", got, want, source)
		}
	}
}

func TestGrammarAdmissionForOfAsyncModuleRegression(t *testing.T) {
	TestGrammarAdmissionForOfAsyncQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"for (async of xs) {}",
		"for\n(async\nof xs) {}",
		"{ for (async of xs) {} }",
		"let async: any; const xs = [1]; for (async of xs) {}",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("module head gained syntax rejection: %v", result.Diagnostics)
				}
			}
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("module async head lost its observed admission gap: %v", result.Diagnostics)
			}
		})
	}
}
