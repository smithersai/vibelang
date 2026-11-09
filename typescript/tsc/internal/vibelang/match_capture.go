package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
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
	return narrowCapturedBindingProperty(c, reference, t, test, narrowAlias)
}

// capturedRead returns the first node of test that reads what reference
// reads through a capture, or nil.
func capturedRead(c *checker.Checker, reference *ast.Node, test *ast.Node) *ast.Node {
	// Keep tests of the binding itself on their ordinary native path before
	// following the value it captured for tests of a later conjunct.
	find := func(reference *ast.Node) (through, direct *ast.Node) {
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if readsThroughCapture(c, reference, node) {
				through = node
				return true
			}
			if (ast.IsAccessExpression(node) || ast.IsIdentifier(node) && isValueUse(node)) &&
				c.IsMatchingReference(reference, node) && direct == nil {
				direct = node
			}
			if ast.IsFunctionLike(node) {
				return false
			}
			return node.ForEachChild(visit)
		}
		visit(test)
		return
	}
	through, direct := find(reference)
	if through != nil {
		return through
	}
	if direct != nil {
		return nil
	}
	if subject := patternBindingSubject(c, reference, test); subject != nil {
		through, direct = find(subject)
		if through != nil {
			return through
		}
		return direct
	}
	return nil
}

// patternBindingSubject follows a binding's single captured value. Multiple or
// alternatives may share that value; source assignments end the relationship.
func patternBindingSubject(c *checker.Checker, reference, test *ast.Node) *ast.Node {
	if !ast.IsIdentifier(reference) || reference.Flags&ast.NodeFlagsReparsed != 0 ||
		ast.IsRightSideOfQualifiedNameOrPropertyAccess(reference) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(reference)
	if symbol == nil {
		return nil
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || declaration.Flags&ast.NodeFlagsVibeLangPatternBinding == 0 {
		return nil
	}
	values := []*ast.Node{declaration.Initializer()}
	if values[0] == nil {
		values = hoistedValues(declaration)
	}
	if len(values) == 0 {
		return nil
	}
	for _, value := range values[1:] {
		if !c.IsMatchingReference(values[0], value) {
			return nil
		}
	}
	var written func(*ast.Node) bool
	written = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsReparsed == 0 && node.Pos() < test.End() && ast.IsAssignmentTarget(node) {
			root := node
			for ast.IsAccessExpression(root) {
				root = root.Expression()
			}
			if ast.IsIdentifier(root) && c.GetSymbolAtLocation(root) == symbol {
				return true
			}
		}
		return node.ForEachChild(written)
	}
	if written(declaration.Parent.Parent.Parent) {
		return nil
	}
	return values[0]
}

// A property used by or may itself be captured once before its literal tests.
// Project its native discriminant narrowing back to the whole captured value,
// including when inline lowering hoists that property into a temporary let.
func narrowCapturedBindingProperty(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	// Finite coverage has its own projection, independent of arm typing.
	if call := reference.Parent; call != nil && ast.IsCallExpression(call) &&
		ast.IsIdentifier(call.Expression()) && call.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 &&
		call.Expression().Text() == "$noMatch" {
		return nil
	}
	subject := patternBindingSubject(c, reference, test)
	if subject == nil {
		if reference.Flags&ast.NodeFlagsReparsed == 0 || capturedSubject(c, reference) == nil {
			return nil
		}
		subject = reference
	}
	var result *checker.Type
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		origin := capturedSubject(c, node)
		for origin != nil && ast.IsIdentifier(ast.SkipParentheses(origin)) {
			next := capturedSubject(c, ast.SkipParentheses(origin))
			if next == nil {
				break
			}
			origin = next
		}
		if origin != nil {
			origin = ast.SkipParentheses(origin)
			if ast.IsAccessExpression(origin) {
				base := origin.Expression()
				if c.IsMatchingReference(subject, base) || readsThroughCapture(c, subject, base) ||
					c.IsMatchingReference(reference, base) || readsThroughCapture(c, reference, base) {
					narrowed := c.NarrowTypeByDiscriminant(t, origin, func(property *checker.Type) *checker.Type {
						return narrowAlias(node, property, nil)
					})
					if narrowed != t {
						result = narrowed
						return true
					}
				}
			}
		}
		if ast.IsFunctionLike(node) {
			return false
		}
		return node.ForEachChild(visit)
	}
	visit(test)
	return result
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
			if b.OperatorToken.Kind == ast.KindEqualsToken && ast.IsIdentifier(b.Left) && b.Left.Text() == name && b.Left.Flags&ast.NodeFlagsReparsed != 0 &&
				(!parser.VibeLangIsRecoveryBindingDeclaration(declaration) || b.Left.Loc == declaration.Name().Loc) {
				found = b.Right
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return found
}

// hoistedValues returns every value the pattern assigns to declaration, one per
// alternative of an or pattern, which share the one cell (chapter 004). A nested
// block that hoists the name again is its own cell.
func hoistedValues(declaration *ast.Node) []*ast.Node {
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
	var values []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindBlock && blockHoists(node, name) {
			return false
		}
		if ast.IsBinaryExpression(node) {
			b := node.AsBinaryExpression()
			if b.OperatorToken.Kind == ast.KindEqualsToken && ast.IsIdentifier(b.Left) && b.Left.Text() == name && b.Left.Flags&ast.NodeFlagsReparsed != 0 {
				values = append(values, b.Right)
				return false
			}
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return values
}

// blockHoists reports whether block itself holds a hoisted let of name.
func blockHoists(block *ast.Node, name string) bool {
	for _, statement := range block.Statements() {
		if !ast.IsVariableStatement(statement) {
			continue
		}
		for _, d := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			if d.Flags&ast.NodeFlagsVibeLangPatternHoist != 0 && d.Name() != nil && ast.IsIdentifier(d.Name()) && d.Name().Text() == name {
				return true
			}
		}
	}
	return false
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
	if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 || !isCaptureName(name.Text()) {
		return nil, nil
	}
	return parser.MatchIsTest(arrow), call.Arguments()[0]
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
