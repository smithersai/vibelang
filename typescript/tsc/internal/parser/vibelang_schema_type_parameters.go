package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const VibeLangSchemaTypeParametersMessage = "A `schema` declaration cannot have type parameters; use an ordinary generic TypeScript factory returning a Schema value."

// Recover the entire forbidden header before parsing the body or alias.
// The zero-width location also lets --fix make the old empty schema explicit,
// leaving the following TypeScript assertion or generic arrow unchanged.
func (p *Parser) parseVibeLangSchemaTypeParameters() {
	if p.token != ast.KindLessThanToken {
		return
	}
	at := p.tokenRange()
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, core.NewTextRange(at.Pos(), at.Pos()), "EK", diagnostics.CategoryError, 1502, VibeLangSchemaTypeParametersMessage))
	p.hasParseError = true
	p.parseTypeParameters()
}
