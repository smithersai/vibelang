package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	checker.RegisterGeneratorAnnotationHook(producerBodyContract)
	fileChecks = append(fileChecks, checkProducerContracts)
}

// hasWrittenProducerContract recognizes the explicit producer syntax. A
// JavaScript iterator annotation cannot turn an effect producer into a native
// generator, and native generators keep their own annotation checks.
func hasWrittenProducerContract(fn *ast.Node) bool {
	if fn == nil || (fn.Kind != ast.KindFunctionDeclaration && fn.Kind != ast.KindFunctionExpression) || fn.Body() == nil || fn.Type() == nil {
		return false
	}
	flags := ast.GetFunctionFlags(fn)
	return fn.Flags&ast.NodeFlagsVibeLangEffect != 0 && flags&ast.FunctionFlagsGenerator != 0 && flags&ast.FunctionFlagsAsync == 0 && isVibeLangFile(ast.GetSourceFileOfNode(fn))
}

// producerContract resolves a written Stream contract, including aliases and
// normalized unions. Erased contracts and genuine container unions are not a
// Stream contract (VIP-21, decided detail 287).
func producerContract(c *checker.Checker, fn *ast.Node) *checker.Type {
	if !hasWrittenProducerContract(fn) {
		return nil
	}
	t := c.GetTypeFromTypeNode(fn.Type())
	stream := streamInterface(c)
	if stream == nil || t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever|checker.TypeFlagsUnion) != 0 || t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 {
		return nil
	}
	domain := c.NewTypeReference(stream, []*checker.Type{c.GetAnyType(), c.GetAnyType(), c.GetAnyType()})
	if !c.IsTypeAssignableTo(t, domain) {
		return nil
	}
	for _, channel := range []string{"_A", "_E", "_R"} {
		if streamChannel(c, t, channel) == nil {
			return nil
		}
	}
	return t
}

func producerBodyContract(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if !hasWrittenProducerContract(fn) {
		return t
	}
	contract := producerContract(c, fn)
	if contract == nil {
		return c.GetAnyType() // EK2102 owns the invalid exposed contract.
	}
	return c.CreateGeneratorType(streamChannel(c, contract, "_A"), c.GetVoidType(), c.GetUndefinedType(), false)
}

func checkProducerContracts(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(fn *ast.Node) bool {
		if hasWrittenProducerContract(fn) {
			contract := producerContract(c, fn)
			if contract == nil {
				report(c, fn.Type(), EK2102)
			} else if info := analyzerFor(c).effectOf(fn); info != nil {
				// Readonly/mapped and inherited aliases keep ordinary structural
				// checking. The constructed Stream must also supply any extra
				// properties demanded by the public annotation.
				container := c.NewTypeReference(streamInterface(c), []*checker.Type{streamChannel(c, contract, "_A"), streamChannel(c, contract, "_E"), streamChannel(c, contract, "_R")})
				c.CheckTypeAssignableTo(container, contract, fn.Type(), nil)
				name := functionDisplayName(fn)
				errors := streamChannel(c, contract, "_E")
				for _, escape := range escapes(c, info.errors, info.errorSources, errors) {
					report(c, escape.source, EK9201, typeTextAt(c, escape.t, escape.source), name, "its contract says E = "+c.TypeToString(errors))
				}
				requirements := streamChannel(c, contract, "_R")
				body := make([]*checker.Type, len(info.requirements))
				for i, required := range info.requirements {
					if scope := analyzerFor(c).programScope(); scope != nil {
						required = c.ExcludeType(required, scope)
					}
					body[i] = required
				}
				for _, escape := range escapes(c, body, info.requirementSources, requirements) {
					report(c, escape.source, EK9202, name, typeTextAt(c, escape.t, escape.source), c.TypeToString(requirements))
				}
			}
		}
		return fn.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
