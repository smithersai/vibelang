package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A saved callable union preserves every alternative's signature contract.
// Check each alternative against a native-compatible destination alternative;
// every overload of that destination must admit a matching source signature.
func checkUnionCallbackValue(c *checker.Checker, expr *ast.Node) bool {
	source := c.GetTypeAtLocation(expr)
	if source == nil || source.Flags()&checker.TypeFlagsUnion == 0 {
		return false
	}
	contextual := c.GetContextualType(expr, checker.ContextFlagsNone)
	if contextual == nil {
		return false
	}
	if !c.IsTypeAssignableTo(source, contextual) {
		return true
	}
	destinations := alternativesOf(contextual)
	for _, member := range source.Types() {
		sources := c.GetSignaturesOfType(member, checker.SignatureKindCall)
		if len(sources) == 0 {
			continue
		}
		contracts := make([]throwContract, len(sources))
		for i, sig := range sources {
			contracts[i] = foreignSignatureThrows(c, sig)
		}
		fit := callbackFit{
			kind:     checker.SignatureKindCall,
			provided: func(i int, _ *checker.Signature) (throwContract, bool) { return contracts[i], true },
			required: writtenBound(c),
		}
		admitted, _, rejected := fit.fits(c, member, sources, destinations)
		if !admitted {
			if admittedByShippedContract(c, expr) {
				return true
			}
			name := scanner.GetTextOfNode(expr)
			d := report(c, expr, EK0402)
			note(d, "{0} includes a callable union alternative declared @throws {{1}} that its contextual function type does not admit.", name, thrownText(c, rejected))
			note(d, "Pass a function that handles the throw, call {0} through Effect.try, or write @throws on the function signature.", name)
			return true
		}
	}
	return true
}
