package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Tags belong to individual call signatures (Chapter 3, Throw tracking).
// Match overloads with TypeScript's signature relation before comparing their
// throws contracts. An unrelated overload cannot poison a safe match, and a
// local alias retains the same overload contracts.
func checkOverloadedCallbackValue(c *checker.Checker, expr *ast.Node) bool {
	source := c.GetTypeAtLocation(expr)
	if source == nil || source.Flags()&checker.TypeFlagsUnion != 0 {
		return false
	}
	sources := c.GetSignaturesOfType(source, checker.SignatureKindCall)
	if len(sources) == 0 {
		return false
	}
	if admittedByShippedContract(c, expr) {
		return true
	}
	contextual := c.GetContextualType(expr, checker.ContextFlagsNone)
	if contextual == nil {
		return false
	}
	members := alternativesOf(contextual)
	if len(sources) == 1 {
		overloadedDestination := false
		for _, member := range members {
			if len(c.GetSignaturesOfType(member, checker.SignatureKindCall)) > 1 {
				overloadedDestination = true
				break
			}
		}
		if !overloadedDestination {
			return false
		}
	}
	contracts := make([]throwContract, len(sources))
	for i, signature := range sources {
		contracts[i] = foreignSignatureThrows(c, signature)
	}
	fit := callbackFit{
		kind:     checker.SignatureKindCall,
		provided: func(i int, _ *checker.Signature) (throwContract, bool) { return contracts[i], true },
		required: writtenBound(c),
	}
	fits, nativeMatch, rejected := fit.fits(c, source, sources, members)
	if fits {
		return true // All overloads of one union alternative must fit.
	}
	if nativeMatch {
		name := scanner.GetTextOfNode(expr)
		d := report(c, expr, EK0402)
		note(d, "{0} has a matching overload declared @throws {{1}} that its contextual function type does not admit.", name, thrownText(c, rejected))
		note(d, "Pass a function that handles the throw, call {0} through Effect.try, or write @throws on the matching function signature.", name)
	}
	return true
}
