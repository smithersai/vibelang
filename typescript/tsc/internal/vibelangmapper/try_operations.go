package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func tryOperationHelper(node *ast.Node) string {
	if node.Kind != ast.KindCallExpression || len(node.Arguments()) != 1 {
		return ""
	}
	callee := node.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return ""
	}
	switch callee.Text() {
	case "$tryAll", "$tryRace", "$tryAny", "$tryAllSettled":
		return callee.Text()
	}
	return ""
}
func (p *projector) tryOperation(call *ast.Node, e env) {
	if !e.effect {
		p.formChoice(call, "A try operation must run in an Effect body; move it into an effect function or block.")
		return
	}
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	operand := call.Arguments()[0]
	p.plan.mark(editRun, partOpen, start, start, "")
	p.plan.replace(start, p.tokenStart(operand), helperRef(tryOperationHelper(call))+"(")
	operandEnv := e
	operandEnv.holdCalls = true
	p.visit(operand, operandEnv)
	p.plan.insert(call.End(), ")")
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
}

// An explicit try in an operand runs its value once. Do not use the
// legacy call-form classifier: a plain factory may return this Effect.
func (p *projector) tryOperandExpression(node *ast.Node, e env) {
	if !e.effect {
		p.formChoice(node, "A try must run in an Effect body; move it into an effect function or block.")
		return
	}
	start := p.tokenStart(node)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	p.plan.insert(start, helperRef("$try")+"(")
	valueEnv := e
	valueEnv.rawTry = node
	p.visit(node, valueEnv)
	p.plan.insert(node.End(), ")")
	p.plan.mark(editRun, partClose, node.End(), node.End(), "")
}

type tryOperandMark struct {
	kind         ast.Kind
	keyword, end int
}

// lower reparses after blanking call-form try keywords. Preserve their
// syntax only inside the new operands, where calls otherwise stay values.
func tryOperandMarks(file *ast.SourceFile, text string) []tryOperandMark {
	var marks []tryOperandMark
	var visit func(*ast.Node, bool)
	visit = func(node *ast.Node, operand bool) {
		if operand && node.Flags&ast.NodeFlagsVibeLangTry != 0 {
			marks = append(marks, tryOperandMark{node.Kind, scanner.SkipTrivia(text, node.Pos()), node.End()})
		}
		if tryOperationHelper(node) != "" {
			visit(node.Arguments()[0], true)
			return
		}
		if ast.IsFunctionLike(node) && !(ast.IsArrowFunction(node) && node.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0) {
			operand = false
		}
		node.ForEachChild(func(child *ast.Node) bool { visit(child, operand); return false })
	}
	file.AsNode().ForEachChild(func(node *ast.Node) bool { visit(node, false); return false })
	return marks
}

func restoreTryOperandMarks(file *ast.SourceFile, text string, marks []tryOperandMark) {
	if len(marks) == 0 {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		for _, mark := range marks {
			if node.Kind == mark.kind && node.End() == mark.end && scanner.SkipTrivia(text, mark.keyword) == scanner.SkipTrivia(text, node.Pos()) {
				node.Flags |= ast.NodeFlagsVibeLangTry
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
