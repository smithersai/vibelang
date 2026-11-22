package parser

import (
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// nextTokenIsBlockOrDoBlock recognizes a direct block and the invalid
// extra do before one. The latter gets an EK diagnostic rather than being
// recovered as a TypeScript do/while statement.
func (p *Parser) nextTokenIsBlockOrDoBlock() bool {
	p.nextToken()
	if p.hasPrecedingLineBreak() {
		return false
	}
	if p.token == ast.KindDoKeyword {
		p.nextToken()
	}
	return p.token == ast.KindOpenBraceToken
}

// rejectVibeLangBlockDo consumes only the invalid do. Parsing the block
// normally after reporting it prevents a cascade of missing-while errors.
func (p *Parser) rejectVibeLangBlockDo(keyword string) {
	if p.token != ast.KindDoKeyword {
		return
	}
	replacement := keyword + " { ... }"
	if keyword == "fork" {
		replacement = "fork effect { ... }"
	}
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.tokenRange(), "EK", diagnostics.CategoryError, 1003,
		fmt.Sprintf("do does not follow %s in VibeLang: write %s.", keyword, replacement)))
	p.hasParseError = true
	p.nextToken()
}
