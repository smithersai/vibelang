package checker

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Pattern lowering must still type its extracted bindings when an enclosing
// return makes TypeScript omit their flow graph. Replay only the enclosing
// compiler-written tests for a compiler-written capture. Source references
// and the reachability of the surrounding activation remain unchanged.
func (c *Checker) unreachablePatternCaptureType(reference *ast.Node, declared *Type) *Type {
	if !ast.IsIdentifier(reference) || reference.Flags&ast.NodeFlagsReparsed == 0 ||
		!strings.HasPrefix(reference.Text(), "$match") || !ast.GetSourceFileOfNode(reference).FileName().IsVibeLangSource() {
		return declared
	}
	if remainder := c.unreachableMatchRemainder(reference, declared); remainder != nil {
		return remainder
	}
	var conditions []*ast.Node
	for child, parent := reference, reference.Parent; parent != nil; child, parent = parent, parent.Parent {
		if ast.IsFunctionLike(parent) {
			break
		}
		if ast.IsIfStatement(parent) && parent.AsIfStatement().ThenStatement == child {
			condition := parent.AsIfStatement().Expression
			if isUnreachablePatternCondition(condition) {
				conditions = append(conditions, condition)
			}
		}
	}
	if len(conditions) == 0 {
		return declared
	}
	f := c.getFlowState()
	f.reference = reference
	f.declaredType = declared
	f.initialType = declared
	result := declared
	for i := len(conditions) - 1; i >= 0; i-- {
		result = c.narrowType(f, result, conditions[i], true)
	}
	c.putFlowState(f)
	return result
}

// Spanning expressions retain their source children: the parser marker belongs
// to the operator or intrinsic callee, not to the whole expression.
func isUnreachablePatternCondition(condition *ast.Node) bool {
	condition = ast.SkipParentheses(condition)
	if ast.IsBinaryExpression(condition) {
		return condition.AsBinaryExpression().OperatorToken.Flags&ast.NodeFlagsReparsed != 0
	}
	if ast.IsCallExpression(condition) {
		callee := condition.Expression()
		if ast.IsPropertyAccessExpression(callee) {
			callee = callee.Name()
		}
		return callee.Flags&ast.NodeFlagsReparsed != 0
	}
	return condition.Flags&ast.NodeFlagsReparsed != 0
}

// Only the generated $noMatch query replays preceding arms. Source references
// retain TypeScript unreachable flow, including source reads inside an arm.
func (c *Checker) unreachableMatchRemainder(reference *ast.Node, declared *Type) *Type {
	call := reference.Parent
	if call == nil || !ast.IsCallExpression(call) || !ast.IsIdentifier(call.Expression()) || call.Expression().Text() != "$noMatch" || call.Expression().Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	statement := call.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return nil
	}
	f := c.getFlowState()
	f.reference, f.declaredType, f.initialType = reference, declared, declared
	f.unreachablePatternCoverage = true
	defer c.putFlowState(f)
	result := declared
	for _, arm := range statement.Parent.Statements() {
		if arm == statement {
			break
		}
		if ast.IsBlock(arm) {
			result = c.unreachablePatternStatements(f, result, arm.Statements())
		}
	}
	return result
}

// Follow the compiler-written pattern tests until an arm succeeds. A failure
// proceeds to the next arm; success leaves the match. No source expression is
// evaluated or treated as a new control-flow proof.
func (c *Checker) unreachablePatternStatements(f *FlowState, t *Type, statements []*ast.Node) *Type {
	for _, statement := range statements {
		switch {
		case ast.IsIfStatement(statement):
			branch := statement.AsIfStatement()
			if !isUnreachablePatternCondition(branch.Expression) || !ast.IsBlock(branch.ThenStatement) || branch.ElseStatement != nil {
				return t
			}
			unmatched := c.narrowType(f, t, branch.Expression, false)
			matched := c.narrowType(f, t, branch.Expression, true)
			matched = c.unreachablePatternStatements(f, matched, branch.ThenStatement.Statements())
			t = c.GetUnionType([]*Type{unmatched, matched})
		case ast.IsBlock(statement):
			t = c.unreachablePatternStatements(f, t, statement.Statements())
		case ast.IsReturnStatement(statement), ast.IsBreakStatement(statement):
			return c.neverType
		case ast.IsVariableStatement(statement), ast.IsExpressionStatement(statement):
			// Captures and arm values add no coverage proof. Continue to the
			// generated return or break that completes a successful arm.
		default:
			return t
		}
	}
	return t
}

// A value operand with a union type holds only one value at runtime. Its
// failed comparison cannot exclude every member of that type. Preserve native
// recursive boolean narrowing so other alternatives still receive credit.
func (c *Checker) isUnreachableUnionValuePattern(test *ast.Node) bool {
	if !ast.IsCallExpression(test) || !ast.IsIdentifier(test.Expression()) || test.Expression().Text() != "$is" || test.Expression().Flags&ast.NodeFlagsReparsed == 0 || len(test.Arguments()) != 2 {
		return false
	}
	matcher := c.TypeOfPatternMatcher(test.Arguments()[0])
	return matcher.flags&TypeFlagsUnion != 0 || matcher.flags&(TypeFlagsUnit|TypeFlagsObject) == 0
}
