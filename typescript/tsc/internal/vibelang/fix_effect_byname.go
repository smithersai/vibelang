package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// byNameHasTail excludes expressions whose result is an Effect. Their old
// lowering enters the tail after its generator finishes; wrapping the tail
// in an effect block would add an interruptible continuation after it.
func (a *analyzer) byNameHasTail(node *ast.Node) bool {
	tail := false
	byNameResults(node, func(result *ast.Node) {
		tail = tail || a.heldPrograms[result] || isInvocation(result) && a.runs(result) && a.directCallee(result) == nil
	})
	return tail
}

// byNameEffectText makes an expression that computes a success value into
// an explicit lazy program, retaining the source text and its comments.
func (a *analyzer) byNameEffectText(file *ast.SourceFile, node *ast.Node) string {
	start := scanner.SkipTrivia(file.Text(), node.Pos())
	edits, _ := a.effectEditsIn(file, node)
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n != node && a.conversions[n] != nil && a.finalConversion(n) == convertByName {
			return false
		}
		if isInvocation(n) && !tried(n) && n.Flags&(ast.NodeFlagsVibeLangTry|ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) == 0 && a.performs(n) {
			if a.directCallee(n) == nil || a.directToMarked(n) {
				edits = append(edits, tryEditsAt(file, n)...)
			}
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	for i := range edits {
		edits[i].start -= start
		edits[i].end -= start
	}
	value := applyEdits(file.Text()[start:node.End()], mergeInsertions(edits))
	return "effect { return (" + value + ") }"
}
