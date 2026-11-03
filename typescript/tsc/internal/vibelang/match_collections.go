package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	checker.RegisterCallExpressionTypeHook(collectionExtractionType)
}

// collectionExtractionType follows VIP-7's [subject] extraction for Map and
// Set. InstanceType of their generic constructors erases the subject's type
// arguments; narrow the actual captured subject as instanceof does instead.
// Compare resolved types so constructor aliases work and local matchers with
// the same spelling retain their own declared extraction.
func collectionExtractionType(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	if !isPatternCall(call, "$extract") {
		return t
	}
	_, instance := collectionMatcherInstance(c, call.Arguments()[0])
	if instance == nil {
		return t
	}
	subject := c.GetTypeAtLocation(call.Arguments()[1])
	return c.CreatePatternExtractionType([]*checker.Type{c.NarrowTypeTo(subject, instance, true)})
}

func collectionMatcherInstance(c *checker.Checker, matcher *ast.Node) (string, *checker.Type) {
	constructor := c.TypeOfPatternMatcher(matcher)
	// An explicitly declared custom matcher takes precedence over the adapter.
	if name := customMatcherPropertyName(c); name != "" && c.GetPropertyOfType(constructor, name) != nil {
		return "", nil
	}
	for _, name := range []string{"Map", "Set"} {
		symbol := c.GlobalSymbol(name, ast.SymbolFlagsValue)
		if symbol == nil || constructor != c.GetTypeOfSymbol(symbol) {
			continue
		}
		signatures := c.GetSignaturesOfType(constructor, checker.SignatureKindConstruct)
		if len(signatures) == 0 {
			return "", nil
		}
		instance := c.GetReturnTypeOfSignature(c.GetErasedSignature(signatures[len(signatures)-1]))
		return name, instance
	}
	return "", nil
}
