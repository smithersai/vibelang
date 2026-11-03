package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK0706 = message(706, errorCategory, "A return, break or continue cannot leave an async match. Keep its target inside the async match.")

func init() {
	registry[EK0706.Code] = EK0706
	fileChecks = append(fileChecks, checkAsyncMatchPromises)
}

// VIP-7 / VIP-4: the boundary's body is native async code, but creating its
// Promise in effect code still needs an explicit Promise bridge. Ordinary
// call trust treats its generated declaration as a same-file VibeLang call.
func checkAsyncMatchPromises(c *checker.Checker, file *ast.SourceFile) {
	for _, fn := range parser.VibeLangAsyncMatches(file) {
		expression := fn
		for expression.Parent != nil && ast.IsParenthesizedExpression(expression.Parent) {
			expression = expression.Parent
		}
		call := expression.Parent
		if call != nil && ast.IsCallExpression(call) && call.Expression() == expression &&
			inEffectCode(call) && !inHatch(call) {
			report(c, call, EK0404)
		}
	}
}
