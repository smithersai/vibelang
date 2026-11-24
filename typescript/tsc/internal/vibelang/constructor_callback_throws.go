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
	contract := writtenThrows(c, decl)
	// Chapter 3, Thrown types: a foreign declaration with no tag throws
	// unknown, so an unannotated constructor fits only a construct signature
	// that admits unknown, as an unannotated function fits only such a
	// callback type. A class that declares no constructor has no signature
	// to carry a tag and stays untracked, as its construction does.
	if !contract.tagged && decl.Kind == ast.KindConstructor {
		contract.unknown = true
	}
	return contract
}

func checkConstructorCallbackValue(c *checker.Checker, expr *ast.Node) {
	source := c.GetTypeAtLocation(expr)
	destination := c.GetContextualType(expr, checker.ContextFlagsNone)
	if source == nil || destination == nil || !c.IsTypeAssignableTo(source, destination) {
		return
	}
	destinations := alternativesOf(destination)
	for _, member := range alternativesOf(source) {
		signatures := c.GetSignaturesOfType(member, checker.SignatureKindConstruct)
		if len(signatures) == 0 {
			continue
		}
		contracts := make([]throwContract, len(signatures))
		for i, sig := range signatures {
			contracts[i] = constructorSignatureThrows(c, sig)
		}
		// A destination instantiated from this constructor's own
		// declaration carries that declaration's thrown contract.
		fit := callbackFit{
			kind:     checker.SignatureKindConstruct,
			plain:    true,
			own:      true,
			provided: func(i int, _ *checker.Signature) (throwContract, bool) { return contracts[i], true },
			required: writtenBound(c),
		}
		admitted, _, rejected := fit.fits(c, member, signatures, destinations)
		if !admitted {
			name := scanner.GetTextOfNode(expr)
			d := report(c, expr, EK0402)
			if rejected.unknown && len(rejected.types) == 0 {
				note(d, "{0} includes an unannotated foreign constructor, whose thrown type is unknown; its contextual construct signature does not admit it.", name)
			} else {
				note(d, "{0} includes a constructor declared @throws {{1}} that its contextual construct signature does not admit.", name, thrownText(c, rejected))
			}
			note(d, "Pass a constructor that handles the throw, or write @throws on the construct signature.")
			return
		}
	}
}
