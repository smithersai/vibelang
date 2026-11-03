package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Generic coverage uses the constraint of the type exposed at the capture,
// including represented intersections. Replaying only the match's own tests
// keeps a bare T conservative after an outer guard, without casting the
// subject or changing arm/default flow types (VIP-7, detail 210).
func genericMatchRemainder(c *checker.Checker, call *ast.Node) (declared, left *checker.Type) {
	subject := call.Arguments()[0]
	captured := capturedSubject(c, subject)
	if captured == nil {
		return nil, nil
	}
	declared = c.GetTypeAtLocation(captured)
	if constraint := c.GetBaseConstraintOfType(declared); constraint != nil {
		declared = constraint
	}
	if !isFiniteMatchType(c, declared) {
		return nil, nil
	}
	statement := call.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return nil, nil
	}
	left = declared
	for _, arm := range statement.Parent.Statements() {
		if arm == statement {
			break
		}
		if ast.IsBlock(arm) {
			left = genericArmRemainder(c, subject, left, arm)
		}
	}
	return declared, left
}

// Each parser arm is a block of declarations followed by nested if tests.
// Only the failure paths reach the next arm. The success value is opaque:
// return/throw/do completion inside it must not affect coverage.
func genericArmRemainder(c *checker.Checker, subject *ast.Node, domain *checker.Type, block *ast.Node) *checker.Type {
	for _, statement := range block.Statements() {
		if ast.IsVariableStatement(statement) {
			continue
		}
		if !ast.IsIfStatement(statement) || statement.AsIfStatement().ElseStatement != nil {
			return c.GetNeverType()
		}
		test := statement.Expression()
		yes := c.NarrowTypeByTest(subject, domain, test, true)
		no := c.NarrowTypeByTest(subject, domain, test, false)
		then := statement.AsIfStatement().ThenStatement
		if !ast.IsBlock(then) {
			return domain
		}
		return c.GetUnionType([]*checker.Type{no, genericArmRemainder(c, subject, yes, then)})
	}
	return c.GetNeverType()
}
