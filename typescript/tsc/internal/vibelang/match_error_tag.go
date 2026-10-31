package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// An error class pattern narrows as Effect.catchTag does (decided detail
// 103; chapter 004, Typing): when NotFound: and when NotFound(let e): narrow
// the subject, and type e, to the subject's own members whose _tag is
// "NotFound", Extract<S, { readonly _tag: "NotFound" }>, a plain object with
// that tag or another package's copy of the class included, since the
// generated matcher tests the tag. Only a subject with no such member keeps
// the declared class, as instanceof narrows. narrowExtractedError
// (match_extract.go) narrows an extractor's success test with
// narrowByErrorTag; the hooks here narrow the bare pattern and type the
// extracted value.

func init() {
	checker.RegisterFlowNarrowingHook(narrowBareErrorPattern)
	checker.RegisterExpressionTypeHook(extractedErrorType)
}

// errorTagMembers splits t's members by whether their _tag is instance's
// literal tag.
func errorTagMembers(c *checker.Checker, t, instance *checker.Type) (matched, rest []*checker.Type) {
	tag := c.GetTypeOfPropertyOfType(instance, "_tag")
	if tag == nil || tag.Flags()&checker.TypeFlagsStringLiteral == 0 {
		return nil, nil
	}
	text := c.TypeToString(tag)
	for _, member := range members(t) {
		if own := c.GetTypeOfPropertyOfType(member, "_tag"); own != nil && own.Flags()&checker.TypeFlagsStringLiteral != 0 && c.TypeToString(own) == text {
			matched = append(matched, member)
		} else {
			rest = append(rest, member)
		}
	}
	return matched, rest
}

// narrowByErrorTag narrows t by an error declaration's pattern whose class
// constructs instance: to the members with its tag when t has any, else as
// instanceof narrows. Where the pattern fails, the members with its tag and
// the instances of its class are gone.
func narrowByErrorTag(c *checker.Checker, t, instance *checker.Type, assumeTrue bool) *checker.Type {
	matched, _ := errorTagMembers(c, t, instance)
	if len(matched) == 0 {
		return c.NarrowTypeTo(t, instance, assumeTrue)
	}
	if assumeTrue {
		return c.GetUnionType(matched)
	}
	left := slices.DeleteFunc(slices.Clone(members(c.NarrowTypeTo(t, instance, false))), func(member *checker.Type) bool {
		return slices.Contains(matched, member)
	})
	if len(left) == 0 {
		return c.GetNeverType()
	}
	return c.GetUnionType(left)
}

// errorDeclarationInstance returns the instance type of matcher, a pattern's
// matcher, when it names an error declaration, whose generated matcher
// tests the tag, or nil.
func errorDeclarationInstance(c *checker.Checker, matcher *ast.Node) *checker.Type {
	t := c.TypeOfPatternMatcher(matcher)
	if t == nil {
		return nil
	}
	symbol := t.Symbol()
	if symbol == nil || !isExtractedErrorClass(symbol.ValueDeclaration()) {
		return nil
	}
	signatures := c.GetConstructSignatures(t)
	if len(signatures) == 0 {
		return nil
	}
	return c.GetReturnTypeOfSignature(signatures[0])
}

// narrowBareErrorPattern is the flow narrowing hook for when NotFound:, the
// parser's $is(NotFound, subject) for an error declaration.
func narrowBareErrorPattern(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, _ func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if !isPatternCall(test, "$is") || len(test.Arguments()) != 2 {
		return nil
	}
	subject := test.Arguments()[1]
	if !c.IsMatchingReference(reference, subject) && !readsThroughCapture(c, reference, subject) {
		return nil
	}
	instance := errorDeclarationInstance(c, test.Arguments()[0])
	if instance == nil {
		return nil
	}
	if matched, _ := errorTagMembers(c, t, instance); len(matched) == 0 {
		return nil
	}
	return narrowByErrorTag(c, t, instance, assumeTrue)
}

// extractedErrorType types $extracted[0], what when NotFound(let e): binds:
// the members of the subject, where the pattern runs, that have the
// declaration's tag, when it has any.
func extractedErrorType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if t == nil || !ast.IsElementAccessExpression(node) {
		return t
	}
	index := node.AsElementAccessExpression().ArgumentExpression
	if index == nil || index.Kind != ast.KindNumericLiteral || index.Text() != "0" {
		return t
	}
	call := extractionCall(c, node.Expression())
	if call == nil {
		return t
	}
	instance := errorDeclarationInstance(c, call.Arguments()[0])
	if instance == nil {
		return t
	}
	if matched, _ := errorTagMembers(c, c.GetTypeAtLocation(call.Arguments()[1]), instance); len(matched) != 0 {
		return c.GetUnionType(matched)
	}
	return t
}
