package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() { fileChecks = append(fileChecks, checkYieldActivations) }

// VIP-21 gives nonproducer Effect activations and directly evaluated
// parameter initializers EK2104. Native callables keep TypeScript's rules.
func checkYieldActivations(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindYieldExpression {
			if parser.VibeLangYieldOutsideProducer(node) {
				d := report(c, node, EK2104)
				if yieldActivationFixable(node) {
					note(d, "For Effect delegation write try e, or remove yield* before an existing try.")
				}
				coverCodes(c, node, 1163, 2523, 7057)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
