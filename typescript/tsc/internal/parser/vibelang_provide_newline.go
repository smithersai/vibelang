package parser

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const VibeLangProvideCommaMessage = "A provider separator cannot have a line break on either side. Keep the providers on one line, or compose them with Layer.mergeAll(…)."

// Only the list's own commas are separators. Parentheses and every other
// expression form keep their internal line breaks, as VIP-12 requires.
func (p *Parser) checkVibeLangProviderLineBreaks(node *ast.Node) {
	if !ast.IsBinaryExpression(node) || node.AsBinaryExpression().OperatorToken.Kind != ast.KindCommaToken {
		return
	}
	binary := node.AsBinaryExpression()
	p.checkVibeLangProviderLineBreaks(binary.Left)
	start := binary.Left.End()
	end := scanner.SkipTrivia(p.sourceText, binary.Right.Pos())
	if strings.ContainsAny(p.sourceText[start:end], "\r\n\u2028\u2029") {
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, core.NewTextRange(start, end), "EK", diagnostics.CategoryError, 1202, VibeLangProvideCommaMessage))
		p.hasParseError = true
	}
	p.checkVibeLangProviderLineBreaks(binary.Right)
}
