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
	members := []*checker.Type{contextual}
	if contextual.Flags()&checker.TypeFlagsUnion != 0 {
		members = contextual.Types()
	}
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
	sourceTypes := make([]*checker.Type, len(sources))
	contracts := make([]throwContract, len(sources))
	for i, signature := range sources {
		sourceTypes[i] = c.NewFunctionType(nil, []*checker.Signature{signature})
		contracts[i] = foreignOverloadThrows(c, signature)
	}
	nativeMatch := false
	var rejected throwContract
	for _, member := range members {
		if !c.IsTypeAssignableTo(source, member) {
			continue // TypeScript reports the ordinary type mismatch.
		}
		nativeMatch = true
		fits := true
		for _, target := range c.GetSignaturesOfType(member, checker.SignatureKindCall) {
			targetType := c.NewFunctionType(nil, []*checker.Signature{target})
			var destination throwContract
			if decl := target.Declaration(); decl != nil {
				destination = writtenThrows(c, decl)
			}
			matched := false
			for i, sourceType := range sourceTypes {
				related := c.IsTypeAssignableTo(sourceType, targetType)
				if len(sources) > 1 || len(c.GetSignaturesOfType(member, checker.SignatureKindCall)) > 1 {
					related = c.IsOverloadSignatureAssignableTo(sources[i], target)
				}
				if !related {
					continue
				}
				if destination.admits(c, contracts[i]) {
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
			return true // All overloads of one union alternative must fit.
		}
	}
	if nativeMatch {
		name := scanner.GetTextOfNode(expr)
		d := report(c, expr, EK0402)
		note(d, "{0} has a matching overload declared @throws {{1}} that its contextual function type does not admit.", name, thrownText(c, rejected))
		note(d, "Pass a function that handles the throw, call {0} through Effect.try, or write @throws on the matching function signature.", name)
	}
	return true
}

// This check covers written foreign contracts, just like foreignThrows.
// VibeLang callables and Effect-returning signatures intrinsically throw never;
// untagged foreign/default contracts remain outside this check.
func foreignOverloadThrows(c *checker.Checker, signature *checker.Signature) throwContract {
	for signature.Target() != nil {
		signature = signature.Target()
	}
	decl := signature.Declaration()
	if decl == nil {
		return throwContract{}
	}
	file := ast.GetSourceFileOfNode(decl)
	if file == nil || isVibeLangFile(file) || isLibFile(c, file) ||
		isEffectfulType(c, c.GetReturnTypeOfSignature(signature)) {
		return throwContract{}
	}
	for _, host := range jsdocHosts(decl) {
		if ast.IsTypeAliasDeclaration(host) {
			return throwContract{}
		}
	}
	return writtenSourceSignatureThrows(c, decl)
}
