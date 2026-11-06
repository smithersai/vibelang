package vibelangmapper

import (
	"slices"

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
	if tryOperationHelper(call) == "$tryAllSettled" {
		p.trySettledOperation(call, operand, start, e)
		return
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	target, close := helperRef(tryOperationHelper(call)), ")"
	if tryOperationHelper(call) == "$tryAll" {
		target = p.names.prelude("Effect") + ".all"
		close = ", { concurrency: \"unbounded\" })"
	}
	p.plan.replace(start, p.tokenStart(operand), target+"(")
	operandEnv := e
	operandEnv.holdCalls = true
	p.visit(operand, operandEnv)
	p.plan.insert(call.End(), close)
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

// tryOfBlock returns where the word try starts when it runs the effect block
// fn directly, or -1. A catch expression's parentheses already end try's
// operand, so a block before catch keeps its try.
func tryOfBlock(text string, fn *ast.Node) int {
	call := fn.Parent
	if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) != 1 || call.Arguments()[0] != fn || catchFollows(text, fn.Body().End()) {
		return -1
	}
	callee := call.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 || callee.Text() != "$try" {
		return -1
	}
	return scanner.SkipTrivia(text, call.Pos())
}

// tryBlockWord is what stands for try before a block it runs. A blanked word
// lets a statement run on from the line before it, so a statement in a list
// ends that line first. An if or a label still owns its one statement.
func tryBlockWord(fn *ast.Node) string {
	statement := fn.Parent.Parent
	if statement == nil || statement.Kind != ast.KindExpressionStatement || statement.Parent == nil {
		return "   "
	}
	switch statement.Parent.Kind {
	case ast.KindBlock, ast.KindSourceFile, ast.KindModuleBlock, ast.KindCaseClause, ast.KindDefaultClause:
		return ";  "
	}
	return "   "
}

// tryBlockMarks records the effect blocks whose try lower writes over, so the
// reparsed arrow still runs where the try stood. Reading keywords keeps the two
// in step: a block loses its try only if its mark exists.
func tryBlockMarks(file *ast.SourceFile, text string, keywords []keyword) []tryOperandMark {
	written := map[int]bool{}
	for _, k := range keywords {
		written[k.at] = true
	}
	var marks []tryOperandMark
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsArrowFunction(node) && node.Body() != nil && ast.IsBlock(node.Body()) {
			// The word's place may hold a semicolon now, so the mark names the block.
			if word := tryOfBlock(text, node); word >= 0 && written[word] {
				marks = append(marks, tryOperandMark{node.Kind, scanner.SkipTrivia(text, node.Pos()), node.End()})
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
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

// No-spread literals use the direct VIP-18 wrappers in both renderings.
// Held and spread operands keep the helper to avoid extra array iteration.
func (p *projector) trySettledOperation(call, operand *ast.Node, start int, e env) {
	p.plan.mark(editRun, partOpen, start, start, "")
	inner := ast.SkipParentheses(operand)
	literal := ast.IsArrayLiteralExpression(inner) && !slices.ContainsFunc(inner.Elements(), ast.IsSpreadElement)
	mode := ""
	if literal {
		mode = "literal"
	}
	p.plan.mark(editSettledCall, partOpen, start, p.tokenStart(operand), mode)
	e.holdCalls = true
	if ast.IsArrayLiteralExpression(inner) {
		for _, element := range inner.Elements() {
			kind, arg := editSettledElement, mode
			value := element
			if ast.IsSpreadElement(element) {
				kind, arg, value = editSettledMap, "spread", element.Expression()
			}
			p.plan.mark(kind, partOpen, p.tokenStart(value), p.tokenStart(value), arg)
			p.visit(value, e)
			p.plan.mark(kind, partClose, value.End(), value.End(), arg)
		}
	} else {
		p.plan.mark(editSettledMap, partOpen, p.tokenStart(operand), p.tokenStart(operand), "")
		p.visit(operand, e)
		p.plan.mark(editSettledMap, partClose, operand.End(), operand.End(), "")
	}
	p.plan.mark(editSettledCall, partClose, call.End(), call.End(), mode)
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
}
