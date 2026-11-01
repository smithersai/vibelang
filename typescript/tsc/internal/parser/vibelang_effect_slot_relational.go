package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Called with the second ! current; lookAhead restores scanner, diagnostics
// and recorded syntax. An ordinary comparison cannot supply a generic head.
func (p *Parser) nextVibeLangRequirementIsComparison() bool {
	if p.nextToken() != ast.KindLessThanToken || p.hasPrecedingLineBreak() {
		return false
	}
	// Match the slot type context before probing generic type names.
	p.setContextFlags(ast.NodeFlagsTypeExcludesFlags, false)
	n := len(p.diagnostics)
	p.parseTypeParameters()
	if len(p.diagnostics) != n || p.token != ast.KindOpenParenToken {
		return true
	}
	p.parseParameters(ParseFlagsType)
	return len(p.diagnostics) != n || p.token != ast.KindEqualsGreaterThanToken
}
