package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VibeLangDefaultErrorExportMessage is shared by syntax errors and the EK registry.
const VibeLangDefaultErrorExportMessage = "An `error` or `schema error` declaration cannot follow `export default`; write a named declaration and `export { Name as default }`."

// VibeLangDefaultServiceExportMessage describes the existing VIP-9 rejection.
const VibeLangDefaultServiceExportMessage = "A `service` declaration cannot follow `export default`; write a named declaration and `export { Name as default }`."

// A default export accepts an expression, not these named declarations.
// Keep contextual identifiers in expressions, particularly error as T and
// error satisfies T, and the no-line-break boundary after a declaration word.
func (p *Parser) isVibeLangDefaultNamedExport() bool {
	if !p.isVibeLangFile() || p.token != ast.KindIdentifier {
		return false
	}
	switch p.scanner.TokenValue() {
	case "schema":
		return p.isStartOfVibeLangSchemaError()
	case "error", "service":
		return p.lookAhead(func(p *Parser) bool {
			p.nextToken()
			return !p.hasPrecedingLineBreak() && p.token != ast.KindAsKeyword &&
				p.token != ast.KindSatisfiesKeyword && p.isIdentifier()
		})
	}
	return false
}

func (p *Parser) parseVibeLangDefaultErrorExport(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	if !p.isVibeLangDefaultNamedExport() {
		return nil
	}
	code, message := int32(1305), VibeLangDefaultErrorExportMessage
	if p.scanner.TokenValue() == "service" {
		code, message = 905, VibeLangDefaultServiceExportMessage
	}
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.tokenRange(), "EK", diagnostics.CategoryError, code, message))
	p.hasParseError = true
	// Recover as a named export, retaining the file's module boundary.
	at := p.tokenRange()
	nodes := []*ast.Node{p.vibelangSynthesized(p.factory.NewModifier(ast.KindExportKeyword), at)}
	if modifiers != nil {
		nodes = append(nodes, modifiers.Nodes...)
	}
	modifiers = p.newModifierList(at, nodes)
	// Consume the whole declaration for recovery, including a body when present,
	// so its name and following declarations do not cause secondary syntax errors.
	return p.parseVibeLangDeclaration(pos, jsdoc, modifiers)
}
