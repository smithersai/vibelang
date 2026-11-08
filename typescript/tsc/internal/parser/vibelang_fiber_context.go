package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// ReservedFiberNameDiagnosticCode and Text identify EK1702: fork or join naming
// a binding or label under [+Effect], including an expression's own name
// (VIP-17; Appendix A).
const ReservedFiberNameDiagnosticCode int32 = 1702
const ReservedFiberNameDiagnosticText = "fork and join are reserved in effect code, including an effect expression's own name. Use another binding or label name, and rename its uses."

// setVibeLangFiberContext follows Appendix A's source Effect parameter.
// Returning the restore function makes every early return and speculative
// parse restore its enclosing context.
func (p *Parser) setVibeLangFiberContext(effect bool) func() {
	saved := p.vibelangFiberContext
	p.vibelangFiberContext = effect
	return func() { p.vibelangFiberContext = saved }
}

func (p *Parser) parseVibeLangOrdinaryInitializer() *ast.Node {
	defer p.setVibeLangFiberContext(false)()
	return p.parseInitializer()
}

// isReservedFiberName reports whether the current token is fork or join where
// Appendix A's source Effect parameter reserves them.
func (p *Parser) isReservedFiberName() bool {
	if !p.vibelangFiberContext || p.token != ast.KindIdentifier || !p.isVibeLangFile() {
		return false
	}
	name := p.scanner.TokenValue()
	return name == "fork" || name == "join"
}

// rejectReservedFiberName reports EK1702 at the range of a fork or join that
// binds a name. The tree stays complete, so the file's other reports stand.
func (p *Parser) rejectReservedFiberName(at core.TextRange) {
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, at, "EK", diagnostics.CategoryError, ReservedFiberNameDiagnosticCode, ReservedFiberNameDiagnosticText))
}

func (p *Parser) nextTokenIsEqualsGreaterThan() bool {
	return p.nextToken() == ast.KindEqualsGreaterThanToken
}

func (p *Parser) nextTokenIsColonToken() bool {
	return p.nextToken() == ast.KindColonToken
}
