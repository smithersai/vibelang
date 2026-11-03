package vibelang

import (
	"fmt"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// pipeBodyFixes parenthesizes the conditional or arrow body of each pipe that
// EK2301 rejects. Through VibeLang 0.0.11, x |> f(%) ? a : b compiled as
// x |> (f(%) ? a : b); the parser still reads it so (vibelang_pipes.go), and
// the parentheses keep that meaning. VIP-1 retired the rest of the old pipe
// migration (EK1008's by-name pipes). Bare arrows retain their lexical topic
// capture when parenthesized, as required by VIP-23/detail 246.
func pipeBodyFixes(file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	if !isVibeLangFile(file) || !slices.ContainsFunc(file.Diagnostics(), func(d *ast.Diagnostic) bool { return d.Source() == diagnosticSource && d.Code() == 2301 }) {
		return p
	}
	var taken []sourceEdit
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsBinaryExpression(node) && node.Flags&ast.NodeFlagsVibeLang != 0 && node.AsBinaryExpression().OperatorToken.Kind == ast.KindBarToken {
			if body := node.AsBinaryExpression().Right; body.Kind == ast.KindConditionalExpression || ast.IsArrowFunction(body) {
				start := nodeStart(file, body)
				key := fmt.Sprintf("pipeBody:%d", start)
				fix := fileFix{code: 2301, edits: []sourceEdit{{start, start, "("}, {body.End(), body.End(), ")"}}, key: key}
				if !refused[key] && !overlapsAny(fix.edits[0], taken) {
					p.fixes = append(p.fixes, fix)
					taken = append(taken, fix.edits...)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return p
}
