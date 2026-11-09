package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { fileChecks = append(fileChecks, checkSpreadCallbackThrows) }

// A fixed spread checks its callable elements at their runtime argument
// positions. The tuple's inferred signatures do not replace the callee's
// written callback contracts.
func checkSpreadCallbackThrows(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if replacement := schemaGenericReplacement(c, node); replacement != nil {
			return visit(replacement)
		}
		if ast.IsCallExpression(node) || ast.IsNewExpression(node) {
			checkInvocationSpreadCallbacks(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
func checkInvocationSpreadCallbacks(c *checker.Checker, call *ast.Node) {
	hasSpread := false
	for _, argument := range call.Arguments() {
		hasSpread = hasSpread || ast.IsSpreadElement(argument)
	}
	if !hasSpread {
		return
	}
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return
	}
	position := 0
	for raw, argument := range call.Arguments() {
		if !ast.IsSpreadElement(argument) {
			position++
			continue
		}
		elements, fixed := fixedRethrowsSpreadTypes(c, argument)
		if !fixed && raw == len(call.Arguments())-1 {
			elements, fixed = trailingOptionalRethrowsSpreadTypes(c, argument)
		}
		if !fixed {
			// An unknown-length final array has one element contract when all
			// remaining arguments enter the same array rest parameter.
			element, uniform := uniformRestSpreadElement(c, signature, argument, position)
			if raw != len(call.Arguments())-1 || !uniform {
				return
			}
			elements = []*checker.Type{element}
		}
		for offset, source := range elements {
			slot := position + offset
			if rethrowsRuntimeArgument(c, call, slot) {
				continue
			}
			target := c.GetTypeAtPosition(signature, slot)
			if fits, rejected := writtenSpreadCallbacksFit(c, source, target); !fits {
				d := report(c, argument, EK0402)
				note(d, "The callback supplied at argument position {0} is declared @throws {{1}}; the receiving function type does not admit that thrown type.", slot+1, thrownText(c, rejected))
				note(d, "Pass a callback that handles the throw or declare a compatible @throws contract on the receiving function type.")
				break
			}
		}
		position += len(elements)
	}
}

// Keep this path limited to written foreign contracts. Untagged defaults are
// checked separately, and an inferred type retains its own signature contract.
func writtenSpreadCallbacksFit(c *checker.Checker, source, target *checker.Type) (bool, throwContract) {
	if source == nil || target == nil || !c.IsTypeAssignableTo(source, target) {
		return true, throwContract{}
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, part := range source.Types() {
			if ok, rejected := writtenSpreadCallbacksFit(c, part, target); !ok {
				return false, rejected
			}
		}
		return true, throwContract{}
	}
	provided := c.GetSignaturesOfType(source, checker.SignatureKindCall)
	if len(provided) == 0 {
		return true, throwContract{}
	}
	contracts := make([]throwContract, len(provided))
	tracked := false
	for i, given := range provided {
		contracts[i] = foreignOverloadThrows(c, given)
		tracked = tracked || contracts[i].unknown || len(contracts[i].types) != 0
	}
	if !tracked {
		return true, throwContract{}
	}
	alternatives := []*checker.Type{target}
	if target.Flags()&checker.TypeFlagsUnion != 0 {
		alternatives = target.Types()
	}
	var rejected throwContract
	for _, alternative := range alternatives {
		if !c.IsTypeAssignableTo(source, alternative) {
			continue
		}
		required := c.GetSignaturesOfType(alternative, checker.SignatureKindCall)
		overloaded := len(provided) > 1 || len(required) > 1
		fits := true
		for _, need := range required {
			matched := false
			for i, given := range provided {
				if !callbackSignatureRelated(c, given, need, overloaded) {
					continue
				}
				declaration := need.Declaration()
				if declaration == nil || sameRootSignatureDeclaration(given, need) || writtenThrows(c, declaration).admits(c, contracts[i]) {
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
			return true, throwContract{}
		}
	}
	return false, rejected
}

// A uniform array rest parameter keeps the same receiving callback type at
// every remaining runtime position. Signature parameters already omit this.
// Other variable-width tuple layouts retain their separate position analysis.
func uniformRestSpreadElement(c *checker.Checker, signature *checker.Signature, argument *ast.Node, position int) (*checker.Type, bool) {
	parameters := signature.Parameters()
	if !signature.HasRestParameter() || len(parameters) == 0 || position < len(parameters)-1 {
		return nil, false
	}
	rest := c.GetTypeOfSymbol(parameters[len(parameters)-1])
	source := c.GetTypeAtLocation(argument.Expression())
	if !c.IsArrayType(rest) || !c.IsArrayType(source) {
		return nil, false
	}
	element := c.GetIndexTypeOfType(source, c.GetNumberType())
	return element, element != nil
}
