package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The mapper does not lower a task or workflow declaration (VIP-55) yet. The
// constant the parser writes for one draws one EK9001 that says so.

// durableDeclarationKind returns "task" or "workflow" when node is the
// constant a task or workflow declaration writes, $task<S>()(…) or
// $workflow(…), and "" otherwise.
func durableDeclarationKind(node *ast.Node) string {
	if node.Kind != ast.KindVariableStatement {
		return ""
	}
	declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 || declarations[0].Initializer() == nil || !ast.IsCallExpression(declarations[0].Initializer()) {
		return ""
	}
	callee := declarations[0].Initializer().Expression()
	if ast.IsCallExpression(callee) {
		callee = callee.Expression()
	}
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
		return ""
	}
	switch callee.Text() {
	case "$task":
		return "task"
	case "$workflow":
		return "workflow"
	}
	return ""
}

// durableDeclaration reports node, a task or workflow declaration, as a form
// the mapper does not lower.
func (p *projector) durableDeclaration(node *ast.Node, kind string) {
	if p.reported[p.statement] {
		return
	}
	p.reported[p.statement] = true
	start := scanner.SkipTrivia(p.text, node.Pos())
	p.diagnostics = append(p.diagnostics, Diagnostic{
		Start:   start,
		Length:  node.End() - start,
		Code:    CodeUnprojectedForm,
		Message: "The TypeScript 7 mapper does not lower a " + kind + " declaration yet; compile this file with vibelang.",
	})
}
