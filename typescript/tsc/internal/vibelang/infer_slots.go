package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Retired infer slots report EK4857. The checker still fills their types
// through annotatedReturnType, preserving the existing program contract.

var EK4857 = message(4857, errorCategory, "An Effect slot written infer has no Effect TypeScript spelling; write the type the body gives it, or leave out the whole return annotation.")

func init() {
	registerDiagnostic(EK4857)
	fileChecks = append(fileChecks, func(c *checker.Checker, file *ast.SourceFile) {
		checkFormRules(c, file, []*Message{EK4857})
	})
	tsFormRules[EK4857.Code] = &tsFormRule{
		message: EK4857,
		find: func(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if isLowerable(node) && node.Type() != nil && inferSlotAnnotation(c, node.Type()) {
					report(node.Type(), nil)
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		},
	}
}

// inferSlotAnnotation reports whether annotation, a function's return
// annotation, is a contract that writes a slot `infer Name`.
func inferSlotAnnotation(c *checker.Checker, annotation *ast.Node) bool {
	fn := annotation.Parent
	if fn == nil || fn.Type() != annotation || !isLowerable(fn) {
		return false
	}
	k := analyzerFor(c).contractOf(fn)
	return k != nil && k.reference == annotation && k.inferredAny()
}
