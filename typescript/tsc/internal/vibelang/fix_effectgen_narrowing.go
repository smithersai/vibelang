package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A generator meets a throwing call's exception as a defect, so EK1002's fix
// writes the call through keepThrowDefect's wrapper. The wrapper's function
// loses what control flow proved about a property the call reads, as EK0403's
// does, and keeps the proof the same two ways (planForeignCall): in
// o.p ? f(o.p) : 0 the guard moves into the function with the call, and a
// property an earlier statement proved moves to a const before the statement,
// or under the guard of an unbraced branch, which becomes a block. Where
// neither form applies, the call alone goes through the wrapper, as before,
// and the fix gate decides: the callee may accept what the guard ruled out.
// opencode's
// ai protocols kept their generators over this: the wrapped
// Lifecycle.reasoningDelta(…, content.thinking) read a string | undefined where
// content.thinking !== undefined had proved a string (TS2345).

// throwDefects is keepThrowDefects' plan: the wrappers' edits, and the consts
// each statement needs before it.
type throwDefects struct {
	edits  []sourceEdit
	hoists []*throwHoist
}

// A throwHoist holds the consts that keep what control flow proved before a
// statement.
type throwHoist struct {
	statement *ast.Node
	branch    bool     // the statement is an unbraced branch: it and the consts become a block
	consts    []string // const n2 = o.p
}

// keepThrowDefects plans the wrappers of throwing, the calls of generator's own
// code whose exceptions stay defects.
func keepThrowDefects(c *checker.Checker, a *analyzer, file *ast.SourceFile, generator *ast.Node, throwing []*ast.Node) throwDefects {
	var plan throwDefects
	targets := make([]*ast.Node, len(throwing))
	for i, call := range throwing {
		targets[i] = call
		if !readsNarrowedProperty(c, call) {
			continue
		}
		// A yield* in the guard could not run in the wrapper's plain function.
		if guard := outermostGuardedExpression(call); guard != nil && !holdsYield(guard) {
			targets[i] = guard
		}
	}
	taken := map[string]bool{}
	var names func(n *ast.Node) bool
	names = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			taken[n.Text()] = true
		}
		return n.ForEachChild(names)
	}
	generator.ForEachChild(names)
	wrapped := map[*ast.Node]bool{}
	for i, call := range throwing {
		target := targets[i]
		held := slices.ContainsFunc(targets, func(other *ast.Node) bool {
			return other != target && other.Pos() <= target.Pos() && target.End() <= other.End()
		})
		if wrapped[target] || held {
			continue // one wrapper holds the guard and the calls in it
		}
		wrapped[target] = true
		// A foreign type predicate an if tests keeps its proof in a const
		// that holds the tested value or undefined, as EK0403's fix writes:
		// a boolean from the wrapper would prove nothing.
		if target == call {
			if bridge, _ := foreignPredicateBridge(c, file, call); bridge != nil && !bridge.placed && ast.IsBlock(bridge.statement.Parent) {
				name, _, _ := strings.Cut(strings.TrimPrefix(bridge.declaration, "const "), " ")
				taken[name] = true
				plan.add(bridge.statement, false, bridge.declaration)
				plan.edits = append(plan.edits, bridge.edits...)
				continue
			}
		}
		plan.edits = append(plan.edits, keepThrowDefect(file, target)...)
		if target != call || !readsNarrowedProperty(c, call) {
			continue
		}
		hoist, ok := hoistNarrowedOperands(c, a, file, call, taken)
		if !ok {
			continue
		}
		plan.add(hoist.statement, hoist.branch, hoist.consts...)
		plan.edits = append(plan.edits, hoist.edits...)
	}
	return plan
}

// add puts consts before statement, after those the plan already holds there.
func (p *throwDefects) add(statement *ast.Node, branch bool, consts ...string) {
	for _, h := range p.hoists {
		if h.statement == statement {
			h.consts = append(h.consts, consts...)
			return
		}
	}
	p.hoists = append(p.hoists, &throwHoist{statement: statement, branch: branch, consts: consts})
}

// A narrowedHoist is the consts one call needs, and the edits that read them.
type narrowedHoist struct {
	*throwHoist
	edits []sourceEdit
}

// hoistNarrowedOperands moves each operand of call that reads a narrowed
// property to a const before call's statement, named apart from taken. It
// reports false where the const would run code that could throw, run
// VibeLang or write, read the property at another time, or have no statement
// of a block to precede.
func hoistNarrowedOperands(c *checker.Checker, a *analyzer, file *ast.SourceFile, call *ast.Node, taken map[string]bool) (narrowedHoist, bool) {
	statement, branch := enclosingStatement(call), branchStatement(call)
	if branch != nil {
		statement = branch // the consts go under the branch's guard, in braces
	}
	if statement == nil {
		return narrowedHoist{}, false
	}
	type operand struct {
		node *ast.Node
		name string
	}
	var operands []operand
	callee := ast.SkipParentheses(call.Expression())
	if ast.IsPropertyAccessExpression(callee) || ast.IsElementAccessExpression(callee) {
		operands = append(operands, operand{callee.Expression(), receiverParameterName(callee.Expression())})
	}
	for i, argument := range call.Arguments() {
		if ast.IsSpreadElement(argument) {
			argument = argument.Expression()
		}
		operands = append(operands, operand{argument, argumentParameterName(c, call, i)})
	}
	var inputs []boundaryInput
	for _, op := range operands {
		if !readsNarrowedProperty(c, op.node) {
			continue
		}
		if !runsNoCode(op.node) && !callsOnlySafe(c, a, file, op.node) {
			return narrowedHoist{}, false
		}
		inputs = append(inputs, boundaryInput{node: op.node, pos: nodeStart(file, op.node), end: op.node.End(), param: op.name, text: nodeText(file, op.node)})
	}
	if len(inputs) == 0 {
		return narrowedHoist{}, false
	}
	if a.runsOutOfOrder(statement, call, inputs) {
		return narrowedHoist{}, false
	}
	for _, in := range inputs {
		if runsBefore(statement, in.node) || yieldsBefore(statement, in.node) {
			return narrowedHoist{}, false
		}
	}
	hoist := narrowedHoist{throwHoist: &throwHoist{statement: statement, branch: branch != nil}}
	for _, in := range inputs {
		name := in.param
		for n := 2; taken[name]; n++ {
			name = in.param + strconv.Itoa(n)
		}
		taken[name] = true
		hoist.consts = append(hoist.consts, "const "+name+" = "+in.text)
		hoist.edits = append(hoist.edits, sourceEdit{in.pos, in.end, name})
	}
	return hoist, true
}

// hoistEdits writes the consts of the plan's statements: opens before a
// statement, closes after an unbraced branch's. width is what the rewrite
// removes from the indent of each line of the body.
func (p throwDefects) hoistEdits(file *ast.SourceFile, width int) (opens, closes []sourceEdit) {
	text := file.Text()
	dedent := func(indent string) string {
		if width > 0 && len(indent) >= width {
			return indent[width:]
		}
		return indent
	}
	for _, h := range p.hoists {
		start := nodeStart(file, h.statement)
		if h.branch {
			outer := dedent(lineIndent(text, nodeStart(file, h.statement.Parent)))
			inner := outer + branchIndentUnit(outer)
			opens = append(opens, sourceEdit{start, start, "{\n" + inner + strings.Join(h.consts, "\n"+inner) + "\n" + inner})
			closes = append(closes, sourceEdit{h.statement.End(), h.statement.End(), "\n" + outer + "}"})
			continue
		}
		if line := text[strings.LastIndexByte(text[:start], '\n')+1 : start]; strings.TrimSpace(line) != "" {
			opens = append(opens, sourceEdit{start, start, strings.Join(h.consts, "; ") + "; "}) // the statement shares its line
			continue
		}
		indent := dedent(lineIndent(text, start))
		opens = append(opens, sourceEdit{start, start, strings.Join(h.consts, "\n"+indent) + "\n" + indent})
	}
	return opens, closes
}

// yieldsBefore reports whether a yield in statement's own code ends before node.
func yieldsBefore(statement, node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Pos() >= node.Pos() || isFunctionBoundary(n) {
			return false
		}
		if ast.IsYieldExpression(n) && n.End() <= node.Pos() {
			return true
		}
		return n.ForEachChild(visit)
	}
	return statement.ForEachChild(visit)
}

// runsNoCode reports whether evaluating node calls, constructs, waits for and
// assigns nothing, so a const can evaluate it earlier.
func runsNoCode(node *ast.Node) bool {
	clean := true
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isFunctionBoundary(n):
			return false
		case isInvocation(n), ast.IsNewExpression(n), ast.IsYieldExpression(n), ast.IsAwaitExpression(n), ast.IsDeleteExpression(n), ast.IsPostfixUnaryExpression(n),
			ast.IsPrefixUnaryExpression(n) && (n.AsPrefixUnaryExpression().Operator == ast.KindPlusPlusToken || n.AsPrefixUnaryExpression().Operator == ast.KindMinusMinusToken),
			ast.IsBinaryExpression(n) && ast.IsAssignmentOperator(n.AsBinaryExpression().OperatorToken.Kind):
			clean = false
			return true
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return clean
}

// callsOnlySafe reports whether node's only code is calls that can neither
// throw nor run VibeLang, as o.p.trim() or Math.abs(o.p) on a narrowed
// property: a const that holds it before its statement makes the same calls
// in the same order, and no exception leaves the wrapper that held them.
// EK0403's own bridge hoists such an operand (boundaryInputs); a generator's
// did not, so t3code's foreign(request.elicitationId.trim()) kept its generator.
func callsOnlySafe(c *checker.Checker, a *analyzer, file *ast.SourceFile, node *ast.Node) bool {
	if a.runsVibeLang(node) {
		return false
	}
	safe := true
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case !safe || isFunctionBoundary(n):
			return false
		case ast.IsCallExpression(n):
			if needsBoundary(c, file, n) {
				safe = false
				return true
			}
		case ast.IsTaggedTemplateExpression(n), ast.IsNewExpression(n), ast.IsYieldExpression(n), ast.IsAwaitExpression(n), ast.IsDeleteExpression(n), ast.IsPostfixUnaryExpression(n),
			ast.IsPrefixUnaryExpression(n) && (n.AsPrefixUnaryExpression().Operator == ast.KindPlusPlusToken || n.AsPrefixUnaryExpression().Operator == ast.KindMinusMinusToken),
			ast.IsBinaryExpression(n) && ast.IsAssignmentOperator(n.AsBinaryExpression().OperatorToken.Kind):
			safe = false
			return true
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return safe
}
