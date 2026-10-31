package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The messages of the declaration errors the parser reports, shared with the
// EK registry.
const (
	VibeLangDefaultSchemaExportMessage  = "A `schema` declaration cannot follow `export default`; declare the schema and write `export { Name as default }`."
	VibeLangDefaultDataExportMessage    = "A `data` declaration cannot follow `export default`; declare the type and write `export { Name as default }`."
	VibeLangSchemaTypeParametersMessage = "A `schema` declaration has no type parameters; write an ordinary generic function that returns a Schema value."
)

// vibelangDeclarationError reports code at loc as a syntax error.
func (p *Parser) vibelangDeclarationError(loc core.TextRange, code int32, message string) {
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, loc, "EK", diagnostics.CategoryError, code, message))
	p.hasParseError = true
}

// parseVibeLangDefaultDataExport reads export default schema S and export
// default data D (EK1501, EK1603) as named exports, so the file keeps its
// module boundary and the declaration causes no second syntax error. It
// returns nil when the current token starts neither: schema as T stays an
// expression, and a schema error is an error declaration.
func (p *Parser) parseVibeLangDefaultDataExport(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	if !p.isStartOfVibeLangDeclaration() || p.token != ast.KindIdentifier {
		return nil
	}
	word := p.scanner.TokenValue()
	named := p.lookAhead(func(p *Parser) bool {
		p.nextToken()
		return p.token != ast.KindAsKeyword && p.token != ast.KindSatisfiesKeyword
	})
	switch {
	case !named:
		return nil
	case word == "data":
		p.vibelangDeclarationError(p.tokenRange(), 1603, VibeLangDefaultDataExportMessage)
	case word == "schema" && !p.isStartOfVibeLangSchemaError():
		p.vibelangDeclarationError(p.tokenRange(), 1501, VibeLangDefaultSchemaExportMessage)
	default:
		return nil
	}
	at := p.tokenRange()
	nodes := []*ast.Node{p.vibelangSynthesized(p.factory.NewModifier(ast.KindExportKeyword), at)}
	if modifiers != nil {
		nodes = append(nodes, modifiers.Nodes...)
	}
	return p.parseVibeLangDeclaration(pos, jsdoc, p.newModifierList(at, nodes))
}

// skipSchemaTypeParameters reports the type parameters of a schema declaration
// (EK1502) and reads them, and an alias's = Type, so the rest of the
// declaration causes no second error.
func (p *Parser) skipSchemaTypeParameters() {
	if p.token != ast.KindLessThanToken {
		return
	}
	at := p.tokenRange()
	p.parseTypeParameters()
	p.vibelangDeclarationError(at, 1502, VibeLangSchemaTypeParametersMessage)
	if p.token == ast.KindEqualsToken {
		p.nextToken()
		p.parseType()
		p.parseSemicolon()
	}
}
