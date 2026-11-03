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
	destinations := []*checker.Type{contextual}
	if contextual.Flags()&checker.TypeFlagsUnion != 0 {
		destinations = contextual.Types()
	}
	for _, member := range source.Types() {
		var rejected throwContract
		sources := c.GetSignaturesOfType(member, checker.SignatureKindCall)
		if len(sources) == 0 {
			continue
		}
		sourceTypes := make([]*checker.Type, len(sources))
		contracts := make([]throwContract, len(sources))
		for i, sig := range sources {
			sourceTypes[i] = c.NewFunctionType(nil, []*checker.Signature{sig})
			contracts[i] = foreignUnionSignatureThrows(c, sig)
		}
		admitted := false
		for _, destination := range destinations {
			if !c.IsTypeAssignableTo(member, destination) {
				continue
			}
			fits := true
			for _, target := range c.GetSignaturesOfType(destination, checker.SignatureKindCall) {
				targetType := c.NewFunctionType(nil, []*checker.Signature{target})
				var bound throwContract
				if decl := target.Declaration(); decl != nil {
					bound = writtenThrows(c, decl)
				}
				matched := false
				for i, sourceType := range sourceTypes {
					if !c.IsTypeAssignableTo(sourceType, targetType) {
						continue
					}
					if bound.admits(c, contracts[i]) {
						matched = true
						break
					}
					rejected.unknown = rejected.unknown || contracts[i].unknown
					rejected.types = append(rejected.types, contracts[i].types...)
				}
				if !matched {
					fits = false
					break
				}
			}
			if fits {
				admitted = true
				break
			}
		}
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

// This covers written foreign contracts, leaving untagged defaults to the
// ordinary foreign-call rule. Effect-returning signatures intrinsically throw
// never and are classified before generic instantiation.
func foreignUnionSignatureThrows(c *checker.Checker, signature *checker.Signature) throwContract {
	for signature.Target() != nil {
		signature = signature.Target()
	}
	decl := signature.Declaration()
	if decl == nil {
		return throwContract{}
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil || isVibeLangFile(file) || isLibFile(c, file) || isEffectfulType(c, c.GetReturnTypeOfSignature(signature)) {
		return throwContract{}
	}
	for _, host := range jsdocHosts(decl) {
		if ast.IsTypeAliasDeclaration(host) {
			return throwContract{}
		}
	}
	return writtenThrows(c, decl)
}
