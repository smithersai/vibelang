package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// A do RHS is lifted into a branch testing a single, immutable snapshot of
// its source guard. Inline that compiler capture without adding a source
// alias level or requiring the guarded reference to be constant: reads
// before a later write still narrow, and ordinary assignment flow invalidates
// the fact after the write. The writable completion temporary is never a guard.
func init() { checker.RegisterFlowNarrowingHook(narrowDoGuard) }

func narrowDoGuard(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if source := doGuardSource(c, test); source != nil && !c.IsMatchingReference(reference, test) {
		return narrowDoCondition(c, reference, t, source, assumeTrue, narrowAlias)
	}
	// ?? tests the captured value for nullishness, rather than truthiness.
	// Keep the source relationship for that comparison too, including property
	// reads. This equivalent test is for flow analysis only; it is never emitted.
	if ast.IsBinaryExpression(test) {
		b := test.AsBinaryExpression()
		if b.OperatorToken.Kind == ast.KindEqualsEqualsToken && b.OperatorToken.Flags&ast.NodeFlagsReparsed != 0 && b.Right.Kind == ast.KindNullKeyword {
			if source := doGuardSource(c, b.Left); source != nil && !c.IsMatchingReference(reference, b.Left) {
				return narrowDoNullish(c, reference, t, source, assumeTrue, test, narrowAlias)
			}
		}
	}
	return nil
}

func doGuardSource(c *checker.Checker, node *ast.Node) *ast.Node {
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(node.Text(), "$do_guard") {
		return nil
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return nil
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || !ast.IsVariableDeclaration(declaration) || declaration.Name().Flags&ast.NodeFlagsReparsed == 0 || declaration.Parent.Flags&ast.NodeFlagsConst == 0 {
		return nil
	}
	return declaration.Initializer()
}

// A condition can itself write its subject. On the selected sequential path
// of && or ||, only tests after such a write still apply. The binder already
// carries the assignments into t; do not replay an earlier, stale test.
func narrowDoCondition(c *checker.Checker, reference *ast.Node, t *checker.Type, source *ast.Node, assumeTrue bool, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	source = ast.SkipParentheses(source)
	if origin := doValueOrigin(c, source); origin != nil {
		if origin.Body != nil {
			return t
		}
		if origin.Operator == ast.KindAmpersandAmpersandToken || origin.Operator == ast.KindBarBarToken {
			if (origin.Operator == ast.KindAmpersandAmpersandToken) == assumeTrue {
				if !doGuardWrites(c, reference, origin.Right) {
					t = narrowDoCondition(c, reference, t, origin.Guard, assumeTrue, narrowAlias)
				}
				return narrowDoCondition(c, reference, t, origin.Right, assumeTrue, narrowAlias)
			}
		}
		return t
	}
	if ast.IsPrefixUnaryExpression(source) && source.AsPrefixUnaryExpression().Operator == ast.KindExclamationToken {
		// The callback retains the caller's assumption. Wrap its equivalent
		// test in ! too, so recursive guard analysis and native narrowing agree.
		return narrowDoCondition(c, reference, t, source.AsPrefixUnaryExpression().Operand, !assumeTrue, func(reference *ast.Node, t *checker.Type, equivalent *ast.Node) *checker.Type {
			f := &ast.NodeFactory{}
			negated := f.NewPrefixUnaryExpression(ast.KindExclamationToken, equivalent)
			negated.Parent = source.Parent
			return narrowAlias(reference, t, negated)
		})
	}
	if ast.IsBinaryExpression(source) {
		b := source.AsBinaryExpression()
		op := b.OperatorToken.Kind
		if op == ast.KindCommaToken {
			return narrowDoCondition(c, reference, t, b.Right, assumeTrue, narrowAlias)
		}
		if op == ast.KindAmpersandAmpersandToken || op == ast.KindBarBarToken {
			if (op == ast.KindAmpersandAmpersandToken) == assumeTrue {
				if !doGuardWrites(c, reference, b.Right) {
					t = narrowDoCondition(c, reference, t, b.Left, assumeTrue, narrowAlias)
				}
				return narrowDoCondition(c, reference, t, b.Right, assumeTrue, narrowAlias)
			}
			if doGuardWrites(c, reference, source) {
				return t
			}
		}
	}
	return narrowAlias(reference, t, source)
}

// Reassigning a reference or its base invalidates earlier tests. Writes to
// unrelated properties and calls retain TypeScript's ordinary treatment.
func doGuardWrites(c *checker.Checker, reference, source *ast.Node) bool {
	seen := map[*parser.DoNarrowingOrigin]bool{}
	var visit func(*ast.Node) bool
	visit = func(source *ast.Node) bool {
		if origin := doValueOrigin(c, source); origin != nil {
			if seen[origin] {
				return false
			}
			seen[origin] = true
			if origin.Body != nil {
				return visit(origin.Body)
			}
			return visit(origin.Guard) || visit(origin.Right)
		}
		if guard := doGuardSource(c, source); guard != nil {
			return visit(guard)
		}

		var target *ast.Node
		switch {
		case ast.IsBinaryExpression(source) && ast.IsAssignmentOperator(source.AsBinaryExpression().OperatorToken.Kind):
			target = source.AsBinaryExpression().Left
		case ast.IsPostfixUnaryExpression(source):
			target = source.AsPostfixUnaryExpression().Operand
		case ast.IsPrefixUnaryExpression(source):
			unary := source.AsPrefixUnaryExpression()
			if unary.Operator == ast.KindPlusPlusToken || unary.Operator == ast.KindMinusMinusToken {
				target = unary.Operand
			}
		}
		if target != nil {
			for r := reference; r != nil; {
				if c.IsMatchingReference(r, target) {
					return true
				}
				if !ast.IsAccessExpression(r) {
					break
				}
				r = r.Expression()
			}
		}
		return source.ForEachChild(visit)
	}
	return visit(source)
}

func doValueOrigin(c *checker.Checker, node *ast.Node) *parser.DoNarrowingOrigin {
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(node.Text(), "$do") {
		return nil
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return nil
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || !ast.IsVariableDeclaration(declaration) {
		return nil
	}
	return parser.GetDoNarrowingOrigin(declaration.Name())
}

// A nullish result of an inner ?? selected its nullish left branch. Follow
// that relationship through its saved value, without reading either operand
// again. A do completion itself supplies no predicate on an outer reference.
func narrowDoNullish(c *checker.Checker, reference *ast.Node, t *checker.Type, source *ast.Node, assumeNull bool, test *ast.Node, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	source = ast.SkipParentheses(source)
	if guard := doGuardSource(c, source); guard != nil {
		return narrowDoNullish(c, reference, t, guard, assumeNull, test, narrowAlias)
	}
	if origin := doValueOrigin(c, source); origin != nil {
		if origin.Body != nil {
			return t
		}
		if origin.Operator == ast.KindQuestionQuestionToken && assumeNull {
			if !doGuardWrites(c, reference, origin.Right) {
				t = narrowDoNullish(c, reference, t, origin.Guard, true, test, narrowAlias)
			}
			return narrowDoNullish(c, reference, t, origin.Right, true, test, narrowAlias)
		}
		return t
	}
	f := &ast.NodeFactory{}
	b := test.AsBinaryExpression()
	comparison := f.NewBinaryExpression(nil, source, nil, b.OperatorToken, b.Right)
	comparison.Parent = test.Parent
	return narrowAlias(reference, t, comparison)
}
