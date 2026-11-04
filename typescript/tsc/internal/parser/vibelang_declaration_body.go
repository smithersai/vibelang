package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const VibeLangSchemaMissingBodyCode int32 = 1503
const VibeLangSchemaMissingBodyMessage = "A schema declaration needs a field body or an alias. Write schema Name { fields } or schema Name = Type."

// Chapter006 assigns custom diagnostics to these recognized headers. Retain
// the recovered declaration and leave following statements for normal parsing.
func (p *Parser) reportVibeLangMissingBody(name *ast.Node, code int32, message string) {
	at := name.End()
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, core.NewTextRange(at, at), "EK", diagnostics.CategoryError, code, message))
	p.hasParseError = true
}
