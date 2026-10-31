package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterFlowNarrowingHook(narrowExtractedError) }

// The parser lowers B(pattern) to a const holding $extract(B, subject), a
// success test, a length test, and tests against extracted[0]. For error
// declarations D215 guarantees either false or [subject]. Preserve that
// relationship in flow analysis, including negative branches: otherwise B
// remains at $noMatch and at a default rethrow even after B(let b).
// Custom matchers have no such guarantee and keep ordinary tuple narrowing.
func narrowExtractedError(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, narrowAlias func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	// Only parser-written tests describe the extraction relationship. In
	// particular, never search a user guard's callbacks for nested matches.
	switch {
	case ast.IsBinaryExpression(test):
		if test.AsBinaryExpression().OperatorToken.Flags&ast.NodeFlagsReparsed == 0 {
			return nil
		}
	case ast.IsCallExpression(test):
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
	var visit func(*ast.Node) *checker.Type
	visit = func(node *ast.Node) *checker.Type {
		if ast.IsIdentifier(node) || ast.IsCallExpression(node) {
			if call := extractionCall(c, node); call != nil && (c.IsMatchingReference(reference, call.Arguments()[1]) || readsThroughCapture(c, reference, call.Arguments()[1])) {
				matcher := c.TypeOfPatternMatcher(call.Arguments()[0])
				if symbol := matcher.Symbol(); symbol == nil || !isExtractedErrorClass(symbol.ValueDeclaration()) {
					return nil
				}
				signatures := c.GetConstructSignatures(matcher)
				if len(signatures) == 0 {
					return nil
				}
				instance := c.GetReturnTypeOfSignature(signatures[0])
				parent := node.Parent
				if ast.IsBinaryExpression(parent) && parent == test {
					binary := parent.AsBinaryExpression()
					if binary.Left == node && binary.Right.Kind == ast.KindFalseKeyword && binary.OperatorToken.Kind == ast.KindExclamationEqualsEqualsToken {
						return narrowByErrorTag(c, t, instance, assumeTrue)
					}
				}
				if ast.IsElementAccessExpression(parent) && parent.Expression() == node {
					index := parent.AsElementAccessExpression().ArgumentExpression
					if index.Kind == ast.KindNumericLiteral && index.Text() == "0" {
						// A test of a required field may be irrefutable too,
						// e.g. B({ code: String }) when code is a string.
						for access := parent.Parent; ast.IsAccessExpression(access) && access.Expression() == parent; access = parent.Parent {
							field := c.GetTypeAtLocation(access)
							if narrowed := narrowAlias(access, field, nil); narrowed.Flags()&checker.TypeFlagsNever != 0 {
								return narrowed
							}
							parent = access
						}
						// Use the extracted instance for the subject's own tests.
						return narrowAlias(node.Parent, t, nil)
					}
				}
				if ast.IsPropertyAccessExpression(parent) && parent.Expression() == node && parent.Name().Text() == "length" && ast.IsBinaryExpression(test) {
					binary := test.AsBinaryExpression()
					if binary.Left == parent && binary.Right.Kind == ast.KindNumericLiteral {
						n, err := strconv.Atoi(binary.Right.Text())
						if err != nil {
							return nil
						}
						var matches bool
						switch binary.OperatorToken.Kind {
						case ast.KindEqualsEqualsEqualsToken:
							matches = n == 1
						case ast.KindGreaterThanEqualsToken:
							matches = n <= 1
						default:
							return nil
						}
						if matches != assumeTrue {
							return c.GetNeverType()
						}
						return t
					}
				}
			}
		}
		var result *checker.Type
		node.ForEachChild(func(child *ast.Node) bool {
			result = visit(child)
			return result != nil
		})
		return result
	}
	return visit(test)
}

func extractionCall(c *checker.Checker, node *ast.Node) *ast.Node {
	if ast.IsIdentifier(node) {
		// Only the parser's $extracted<N> consts hold an extraction. Test the
		// name before resolving it: flow analysis asks about every identifier
		// of every test, once per arm for each reference to the subject.
		if node.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(node.Text(), "$extracted") {
			return nil
		}
		symbol := c.GetSymbolAtLocation(node)
		if symbol == nil {
			return nil
		}
		decl := symbol.ValueDeclaration()
		if decl == nil || !ast.IsVariableDeclaration(decl) {
			return nil
		}
		node = hoistedValue(decl)
	}
	if node == nil || !ast.IsCallExpression(node) || len(node.Arguments()) != 2 {
		return nil
	}
	callee := node.Expression()
	if ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$extract" {
		return node
	}
	return nil
}

// Only error declarations have D215's guaranteed extraction. A class may
// override customMatcher, so extending TaggedError alone is not sufficient.
func isExtractedErrorClass(decl *ast.Node) bool {
	if decl == nil || !isTaggedErrorClass(decl) || len(decl.Members()) != 0 {
		return false
	}
	base := ast.GetClassExtendsHeritageElement(decl)
	return base.Expression().Expression().Flags&ast.NodeFlagsReparsed != 0
}
