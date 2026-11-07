package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// isForkOwner reports whether node is fork.in(scope) e, fork.scoped e or
// fork.detached e, as the parser writes them.
func isForkOwner(node *ast.Node) bool {
	return isFiberHelper(node, "$forkIn", 2) || isFiberHelper(node, "$forkScoped", 1) || isFiberHelper(node, "$forkDetach", 1)
}

// forkOwner writes Effect's own operation at the source position. The data-last
// form of Effect.forkIn keeps the scope before the operand, in source order.
func (p *projector) forkOwner(call *ast.Node, e env) {
	if !e.effect {
		p.formChoice(call, "A fork must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
	arguments := call.Arguments()
	operand := arguments[len(arguments)-1]
	operandEnv := e
	operandEnv.holdCalls = true
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	effect := p.names.prelude("Effect")
	switch {
	case len(arguments) == 2:
		scope := arguments[0]
		p.plan.replace(start, p.tokenStart(scope), effect+".forkIn(")
		p.visit(scope, e)
		p.plan.replace(scope.End(), p.tokenStart(operand), ")(")
	case isFiberHelper(call, "$forkScoped", 1):
		p.plan.replace(start, p.tokenStart(operand), effect+".forkScoped(")
	default:
		p.plan.replace(start, p.tokenStart(operand), effect+".forkDetach(")
	}
	p.visit(operand, operandEnv)
	p.plan.insert(call.End(), ")")
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
}

// fiberOperationPositions retains the original parser's operator decisions.
// Removing effect modifiers for projection must not turn a reserved operator
// into an identifier merely because its operand starts on another line.
func fiberOperationPositions(file *ast.SourceFile, text string) *collections.Set[int] {
	positions := &collections.Set[int]{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) && (isKeywordFork(node) || isForkOwner(node) || isFiberHelper(node, "$join", 1)) {
			positions.Add(scanner.SkipTrivia(text, node.Pos()))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return positions
}
