package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Evaluation order (chapter 13). JavaScript evaluates an expression's
// operands left to right, each once, and skips what &&, ||, ??, a conditional
// and ?. skip. A lowering that emits operands in another order than the
// source evaluates them, such as a wire call's arguments in dependency order
// or a try hatch's mapper after its inputs, keeps the source's order with two
// tools:
//
//   - stableValue says which operands may move: evaluating one runs no code,
//     and nothing another operand does can change its value.
//   - inOrder saves each other operand that would run out of order in a fresh
//     variable, assigned in source order before the first emitted operand:
//
//	wire(b(), a())                         wire((operand_1 = a(), b()), operand_1)
//
//     The planner records which source operands are stable (noteStable), since
//     only it has the checker.

// stableValue reports whether node may be evaluated anywhere among the
// operands of its expression: a literal, this, a function or arrow
// expression, or a name that cannot be assigned (a const, function, class,
// enum, namespace or an import of one of them), or such a member of a
// namespace or enum. A let or a parameter can be assigned by another operand,
// and reading another property can run a getter.
func stableValue(c *checker.Checker, node *ast.Node) bool {
	node = ast.SkipOuterExpressions(node, ast.OEKParentheses|ast.OEKAssertions)
	switch node.Kind {
	case ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral,
		ast.KindRegularExpressionLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword, ast.KindThisKeyword,
		ast.KindFunctionExpression, ast.KindArrowFunction:
		return true
	case ast.KindIdentifier:
		symbol := c.GetSymbolAtLocation(node)
		if node.Text() == "undefined" && (symbol == nil || len(symbol.Declarations()) == 0) {
			return true // the global, which strict code cannot assign
		}
		return stableSymbol(c, symbol)
	case ast.KindPropertyAccessExpression:
		return node.QuestionDotToken() == nil && isNamespaceValue(c, node.Expression()) && stableSymbol(c, c.GetSymbolAtLocation(node.Name()))
	}
	return false
}

// stableSymbol reports whether a name that resolves to symbol always reads
// the same value without running code.
func stableSymbol(c *checker.Checker, symbol *ast.Symbol) bool {
	if symbol == nil {
		return false
	}
	symbol = checker.SkipAlias(symbol, c)
	flags := symbol.Flags()
	switch {
	case flags&ast.SymbolFlagsAccessor != 0:
		return false
	case flags&(ast.SymbolFlagsFunction|ast.SymbolFlagsClass|ast.SymbolFlagsEnum|ast.SymbolFlagsValueModule|ast.SymbolFlagsEnumMember) != 0:
		return true // TypeScript rejects assigning these (TS2628 to TS2631)
	case flags&ast.SymbolFlagsVariable != 0:
		return c.IsReadonlySymbol(symbol) // a const
	}
	return false
}

// isNamespaceValue reports whether node names a namespace or an enum, whose
// members are bindings rather than properties another operand can replace.
func isNamespaceValue(c *checker.Checker, node *ast.Node) bool {
	node = ast.SkipOuterExpressions(node, ast.OEKParentheses|ast.OEKAssertions)
	if !ast.IsIdentifier(node) && !ast.IsPropertyAccessExpression(node) || !stableValue(c, node) {
		return false
	}
	symbol := c.GetSymbolAtLocation(node)
	if ast.IsPropertyAccessExpression(node) {
		symbol = c.GetSymbolAtLocation(node.Name())
	}
	if symbol == nil {
		return false
	}
	return checker.SkipAlias(symbol, c).Flags()&(ast.SymbolFlagsValueModule|ast.SymbolFlagsNamespaceModule|ast.SymbolFlagsEnum) != 0
}

// noteStable records which of nodes, operands that the lowering moves, are
// stable values.
func (p *plan) noteStable(c *checker.Checker, nodes ...*ast.Node) {
	if p.stable == nil {
		p.stable = map[*ast.Node]bool{}
	}
	for _, node := range nodes {
		if node != nil && stableValue(c, node) {
			p.stable[node] = true
		}
	}
}

// inOrder returns the operands a lowering emits, in its order, such that they
// still run in source order, each once. operands are the visited operands in
// source order and sources the source nodes they came from; emit lists the
// source index of each emitted operand. When an operand would run after one
// written after it, it and every unstable operand before it are saved in
// fresh variables, assigned in source order ahead of the first emitted
// operand; the operands after them already run in order where they stand. A
// spread operand that is saved is spread into an array first, so it is
// iterated where it was written.
func (tx *lowering) inOrder(operands, sources []*ast.Node, emit []int) []*ast.Node {
	f := tx.Factory()
	position := make([]int, len(operands))
	for k, i := range emit {
		position[i] = k
	}
	saved := 0 // the operands before this index that run out of order are saved
	next := len(emit)
	for i := len(operands) - 1; i >= 0; i-- {
		if tx.plan.stable[sources[i]] {
			continue
		}
		if position[i] > next {
			saved = i + 1
			break
		}
		next = position[i]
	}
	values := append([]*ast.Node(nil), operands...)
	var assignments []*ast.Node
	for i := range saved {
		if tx.plan.stable[sources[i]] {
			continue
		}
		value := operands[i]
		spread := ast.IsSpreadElement(value)
		if spread {
			value = f.NewArrayLiteralExpression(f.NewNodeList([]*ast.Node{value}), false /*multiLine*/)
		}
		name := f.NewUniqueName("operand")
		tx.EmitContext().AddVariableDeclaration(name)
		assignments = append(assignments, f.NewAssignmentExpression(name, tx.captureValue(value)))
		values[i] = name
		if spread {
			values[i] = f.NewSpreadElement(name)
		}
	}
	emitted := make([]*ast.Node, len(emit))
	for k, i := range emit {
		emitted[k] = values[i]
	}
	if len(assignments) != 0 {
		first := emitted[0]
		if ast.IsSpreadElement(first) {
			emitted[0] = f.NewSpreadElement(f.NewParenthesizedExpression(f.InlineExpressions(append(assignments, first.Expression()))))
		} else {
			emitted[0] = f.NewParenthesizedExpression(f.InlineExpressions(append(assignments, first)))
		}
	}
	return emitted
}

// concurrentForCall lowers the call $forConcurrent(items, limit, body) that
// the parser writes for `for concurrent(limit) (const x of items) body`: the
// limit, written first, runs before the items.
func (tx *lowering) concurrentForCall(node *ast.Node) *ast.Node {
	sources := node.Arguments()
	visited := tx.Visitor().VisitNodes(node.ArgumentList()).Nodes
	operands := tx.inOrder([]*ast.Node{visited[1], visited[0], visited[2]}, []*ast.Node{sources[1], sources[0], sources[2]}, []int{1, 0, 2})
	f := tx.Factory()
	return f.UpdateCallExpression(node.AsCallExpression(), tx.Visitor().VisitNode(node.Expression()), node.QuestionDotToken(), nil /*typeArguments*/, f.NewNodeList(operands), node.Flags)
}
