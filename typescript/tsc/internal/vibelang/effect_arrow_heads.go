package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-1/detail247 gives an already-rejected recognized Effect arrow head
// its own error. Ordinary uses of effect and native arrow errors stay native.
var EK0109 = message(parser.EffectArrowHeadDiagnosticCode, errorCategory, parser.EffectArrowHeadDiagnosticText)

func init() {
	registry[EK0109.Code] = EK0109
	tsFormRules[EK0109.Code] = &tsFormRule{
		message: EK0109,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}
