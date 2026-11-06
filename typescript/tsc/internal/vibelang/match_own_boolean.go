package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterFlowNarrowingHook(narrowBooleanOwnClassPattern) }

// An own boolean matcher recognizes values without asserting a subject type.
// Its constructor signature cannot turn that invocation into an instanceof test.
func narrowBooleanOwnClassPattern(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, _ bool, _ func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	matcher, subject := classArmTest(test)
	if matcher == nil || !c.IsMatchingReference(reference, subject) {
		return nil
	}
	constructor := c.TypeOfPatternMatcher(matcher)
	if !hasOwnPatternMatcher(c, constructor) {
		return nil
	}
	name := customMatcherPropertyName(c)
	if name == "" {
		return nil
	}
	property := c.GetPropertyOfType(constructor, name)
	if property == nil {
		return nil
	}
	signatures := c.GetCallSignatures(c.GetTypeOfSymbol(property))
	if len(signatures) == 0 {
		return nil
	}
	for _, signature := range signatures {
		returned := c.GetReturnTypeOfSignature(signature)
		if c.GetTypePredicateOfSignature(signature) != nil ||
			returned.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 ||
			!c.IsTypeAssignableTo(returned, c.GetBooleanType()) {
			return nil
		}
	}
	return t
}
