package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-4 tracks new expressions; VIP-27 retains constructor contracts in
// declarations. A constructor value must keep its written foreign throws
// contract when TypeScript checks it against a contextual construct signature.
func init() {
	fileChecks = append(fileChecks, checkConstructorCallbacks)
}

func checkConstructorCallbacks(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if (ast.IsIdentifier(node) || ast.IsPropertyAccessExpression(node)) && isContextualValue(node) {
			checkConstructorCallbackValue(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func constructorSignatureThrows(c *checker.Checker, signature *checker.Signature) throwContract {
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
	return writtenThrows(c, decl)
}

func checkConstructorCallbackValue(c *checker.Checker, expr *ast.Node) {
	source := c.GetTypeAtLocation(expr)
	destination := c.GetContextualType(expr, checker.ContextFlagsNone)
	if source == nil || destination == nil || !c.IsTypeAssignableTo(source, destination) {
		return
	}
	sources := []*checker.Type{source}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		sources = source.Types()
	}
	destinations := []*checker.Type{destination}
	if destination.Flags()&checker.TypeFlagsUnion != 0 {
		destinations = destination.Types()
	}
	for _, member := range sources {
		signatures := c.GetSignaturesOfType(member, checker.SignatureKindConstruct)
		if len(signatures) == 0 {
			continue
		}
		contracts := make([]throwContract, len(signatures))
		sourceTypes := make([]*checker.Type, len(signatures))
		for i, sig := range signatures {
			contracts[i] = constructorSignatureThrows(c, sig)
			sourceTypes[i] = c.NewFunctionType(nil, []*checker.Signature{sig})
		}
		admitted := false
		var rejected throwContract
		for _, target := range destinations {
			if !c.IsTypeAssignableTo(member, target) {
				continue
			}
			fits := true
			for _, signature := range c.GetSignaturesOfType(target, checker.SignatureKindConstruct) {
				var bound throwContract
				if decl := signature.Declaration(); decl != nil {
					bound = writtenThrows(c, decl)
				}
				targetType := c.NewFunctionType(nil, []*checker.Signature{signature})
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
			name := scanner.GetTextOfNode(expr)
			d := report(c, expr, EK0402)
			note(d, "{0} includes a constructor declared @throws {{1}} that its contextual construct signature does not admit.", name, thrownText(c, rejected))
			note(d, "Pass a constructor that handles the throw, or write @throws on the construct signature.")
			return
		}
	}
}
