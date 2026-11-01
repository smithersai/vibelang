package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A match reads its subject once, before any pattern runs, as JavaScript's
// switch reads its discriminant once (D214). The parser captures the subject
// of a match, and of an is whose pattern binds names, in a const it tests
// ($match1, $is1), and passes the subject of any other is whose pattern
// reads it more than once to a function that tests its parameter
// (parser/vibelang_match.go):
//
//	match (shape.kind) {                  const $match1 = shape.kind
//	  when "circle": area(shape.kind);    { if ($match1 === "circle") { return area(shape.kind) } }
//
//	if (x.v is "a" or "b") use(x.v)       if ((($is2) => ($is2 === "a") || ($is2 === "b"))(x.v)) use(x.v)
//
// TypeScript narrows a switch's discriminant in its clauses, though the
// switch read it once. So that a match narrows its subject as a switch does,
// a test of a capture narrows each reference that reads what the test reads
// through it: the subject itself, shape.kind above, and a property read
// through it, x.radius when the subject is x and the test reads
// $match1.radius. A test of an is function's parameter narrows them where
// the function is called, and narrows x by its discriminant when the subject
// is x.v, as TypeScript narrows shape by a test of the const that holds
// shape.kind. An assignment to the subject between its capture and an arm,
// which a guard can make, ends the narrowing as it would after a switch.

func init() { checker.RegisterFlowNarrowingHook(narrowCapturedSubject) }

// narrowCapturedSubject narrows reference by test when test is a test the
// parser wrote of a captured subject that reference reads.
func narrowCapturedSubject(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	switch {
	case ast.IsBinaryExpression(test):
		// The comparisons and in tests the parser writes. TypeScript
		// narrows by the operands of && and ||, and calls the hooks for
		// each, so they are left to it.
		operator := test.AsBinaryExpression().OperatorToken
		if operator.Flags&ast.NodeFlagsReparsed == 0 {
			return nil
		}
		switch operator.Kind {
		case ast.KindEqualsEqualsEqualsToken, ast.KindExclamationEqualsEqualsToken, ast.KindGreaterThanEqualsToken, ast.KindInKeyword:
		default:
			return nil
		}
	case ast.IsCallExpression(test):
		if body, subject := isFunction(test); body != nil {
			// An is function narrows its argument by its body.
			if read := capturedRead(c, reference, body); read != nil {
				return narrowAlias(read, t, body)
			}
			// It narrows the object of a property it tests by that
			// discriminant, as a test of the property itself would.
			subject = ast.SkipParentheses(subject)
			if !ast.IsAccessExpression(subject) || !c.IsMatchingReference(reference, subject.Expression()) {
				return nil
			}
			read := capturedRead(c, subject, body)
			if read == nil {
				return nil
			}
			if narrowed := c.NarrowTypeByDiscriminant(t, subject, func(property *checker.Type) *checker.Type { return narrowAlias(read, property, body) }); narrowed != t {
				return narrowed
			}
			return nil
		}
		callee := test.Expression()
		if ast.IsPropertyAccessExpression(callee) {
			callee = callee.Name()
		}
		if callee.Flags&ast.NodeFlagsReparsed == 0 {
			return nil
		}
	default:
		return nil
	}
	if read := capturedRead(c, reference, test); read != nil {
		return narrowAlias(read, t, nil)
	}
	return nil
}

// capturedRead returns the first node of test that reads what reference
// reads through a capture, or nil.
func capturedRead(c *checker.Checker, reference *ast.Node, test *ast.Node) *ast.Node {
	var found *ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if readsThroughCapture(c, reference, node) {
			found = node
			return true
		}
		if ast.IsFunctionLike(node) {
			return false // its own tests are narrowed where it is called
		}
		return node.ForEachChild(visit)
	}
	visit(test)
	return found
}

// readsThroughCapture reports whether node, an expression of a test, reads
// what reference reads: node is a capture whose subject reference matches,
// or reads what reference reads through another capture (a part of a
// subject that a pattern reads once, enterSubject in the parser), or an
// access of the same property of one that reads what reference's object
// reads.
func readsThroughCapture(c *checker.Checker, reference *ast.Node, node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	reference = ast.SkipParentheses(reference)
	switch {
	case ast.IsIdentifier(node):
		subject := capturedSubject(c, node)
		return subject != nil && (c.IsMatchingReference(reference, subject) || readsThroughCapture(c, reference, subject))
	case ast.IsAccessExpression(node) && ast.IsAccessExpression(reference):
		name, ok := accessedName(node)
		if !ok {
			return false
		}
		if referenceName, ok := accessedName(reference); !ok || referenceName != name {
			return false
		}
		return readsThroughCapture(c, reference.Expression(), node.Expression())
	}
	return false
}

// accessedName returns the property that node, a property access or an
// element access with a literal argument, reads.
func accessedName(node *ast.Node) (string, bool) {
	if ast.IsPropertyAccessExpression(node) {
		return node.Name().Text(), true
	}
	if ast.IsElementAccessExpression(node) {
		switch argument := ast.SkipParentheses(node.AsElementAccessExpression().ArgumentExpression); argument.Kind {
		case ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindNumericLiteral:
			return argument.Text(), true
		}
	}
	return "", false
}

// capturedSubject returns the subject that node captures when node is a
// capture the parser wrote: a $matchN or $isN const, whose initializer is
// the subject, or the parameter $isN of an is function, whose argument is
// the subject. It returns nil for any other node.
func capturedSubject(c *checker.Checker, node *ast.Node) *ast.Node {
	// Test the name before resolving it: flow analysis asks about every
	// identifier of every test, once per arm for each reference to the
	// subject.
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsReparsed == 0 || !isCaptureName(node.Text()) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return nil
	}
	declaration := symbol.ValueDeclaration()
	switch {
	case declaration == nil || declaration.Name() == nil || declaration.Name().Flags&ast.NodeFlagsReparsed == 0:
		return nil
	case ast.IsVariableDeclaration(declaration):
		return hoistedValue(declaration)
	case ast.IsParameterDeclaration(declaration):
		if call := ast.WalkUpParenthesizedExpressions(declaration.Parent.Parent); call != nil && ast.IsCallExpression(call) {
			if body, subject := isFunction(call); body != nil && ast.SkipParentheses(call.Expression()) == declaration.Parent {
				return subject
			}
		}
	}
	return nil
}

// hoistedValue returns the value declaration, a const or let the parser
// wrote, holds: its initializer, or, for a let that hoistVibeLangIs declared
// without one for a binding home, the right side of the first assignment to
// it in its block, `(name = value, true)`.
func hoistedValue(declaration *ast.Node) *ast.Node {
	if value := declaration.Initializer(); value != nil {
		return value
	}
	if declaration.Name() == nil || !ast.IsIdentifier(declaration.Name()) {
		return nil
	}
	name := declaration.Name().Text()
	block := declaration.Parent
	for block != nil && block.Kind != ast.KindBlock && block.Kind != ast.KindModuleBlock && block.Kind != ast.KindSourceFile {
		block = block.Parent
	}
	if block == nil {
		return nil
	}
	var found *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found != nil {
			return true
		}
		if ast.IsBinaryExpression(node) {
			b := node.AsBinaryExpression()
			if b.OperatorToken.Kind == ast.KindEqualsToken && ast.IsIdentifier(b.Left) && b.Left.Text() == name && b.Left.Flags&ast.NodeFlagsReparsed != 0 {
				found = b.Right
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return found
}

// isCaptureName reports whether name is one the parser gives a capture:
// $match or $is and a number.
func isCaptureName(name string) bool {
	for _, prefix := range []string{"$match", "$is"} {
		if digits, ok := strings.CutPrefix(name, prefix); ok && digits != "" && strings.Trim(digits, "0123456789") == "" {
			return true
		}
	}
	return false
}

// isFunction returns the body of call's function and the subject call passes
// it when call is an is function the parser wrote, (($isN) => test)(subject).
func isFunction(call *ast.Node) (body *ast.Node, subject *ast.Node) {
	arrow := ast.SkipParentheses(call.Expression())
	if !ast.IsArrowFunction(arrow) || len(call.Arguments()) != 1 {
		return nil, nil
	}
	parameters := arrow.Parameters()
	if len(parameters) != 1 {
		return nil, nil
	}
	name := parameters[0].Name()
	if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 || !isCaptureName(name.Text()) || ast.IsBlock(arrow.Body()) {
		return nil, nil
	}
	return arrow.Body(), call.Arguments()[0]
}

// declaredSubject returns the expression whose symbol gives the declared
// type of a match's subject, for node, an argument of the $noMatch or $is
// call the parser wrote: the subject a capture holds when the subject is an
// identifier expression, a name or this and property or literal element
// accesses, whose declaration says what its type is, and node itself
// otherwise.
func declaredSubject(c *checker.Checker, node *ast.Node) *ast.Node {
	if subject := capturedSubject(c, node); subject != nil && isIdentifierExpression(ast.SkipParentheses(subject)) {
		return ast.SkipParentheses(subject)
	}
	return node
}

// isIdentifierExpression reports whether node is a name or this followed by
// property accesses and element accesses whose arguments are literals.
func isIdentifierExpression(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindIdentifier, ast.KindThisKeyword:
		return true
	case ast.KindPropertyAccessExpression:
		return ast.IsIdentifier(node.Name()) && isIdentifierExpression(node.Expression())
	case ast.KindElementAccessExpression:
		switch node.AsElementAccessExpression().ArgumentExpression.Kind {
		case ast.KindStringLiteral, ast.KindNumericLiteral:
			return isIdentifierExpression(node.Expression())
		}
	}
	return false
}
