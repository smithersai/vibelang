package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The VIP-9 syntax errors of a service declaration that the parser reports,
// shared with the EK registry (vibelang/service_syntax.go).
const (
	VibeLangServiceBodyMessage    = "A service declaration needs a body: write its members in braces, as in service Users { find(id: string): User!NotFound }."
	VibeLangAmbientServiceMessage = "A service cannot be declared in an ambient context, after declare or inside a declare namespace or module: a service creates a run-time key. Declare it without declare in a .vibe module."
)

func (p *Parser) vibelangServiceError(loc core.TextRange, code int32, message string) {
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, loc, "EK", diagnostics.CategoryError, code, message))
	p.hasParseError = true
}

// isVibeLangAmbientService reports whether a service declaration with
// modifiers is in an ambient context, explicit (declare service S) or
// inherited (inside declare namespace or declare module): EK0907.
func (p *Parser) isVibeLangAmbientService(modifiers *ast.ModifierList) bool {
	return p.contextFlags&ast.NodeFlagsAmbient != 0 || modifiers != nil && core.Some(modifiers.Nodes, isDeclareModifier)
}

// vibelangServiceModifiers appends the synthesized abstract modifier of a
// service's class to the written modifiers. ServiceStart has no modifier
// slot, so a written abstract is TypeScript's own modifier error at that
// token (TS1042), not TS1030 against the synthesized one; the written token
// is dropped so the class keeps one abstract modifier.
func (p *Parser) vibelangServiceModifiers(modifiers *ast.ModifierList, word core.TextRange) *ast.ModifierList {
	abstract := p.vibelangSynthesized(p.factory.NewModifier(ast.KindAbstractKeyword), word)
	if modifiers == nil {
		return p.newModifierList(word, []*ast.Node{abstract})
	}
	written := make([]*ast.Node, 0, len(modifiers.Nodes)+1)
	for _, modifier := range modifiers.Nodes {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
			p.parseErrorAt(scanner.SkipTrivia(p.sourceText, modifier.Pos()), modifier.End(), diagnostics.X_0_modifier_cannot_be_used_here, "abstract")
			continue
		}
		written = append(written, modifier)
	}
	return p.newModifierList(core.NewTextRange(modifiers.Pos(), word.End()), append(written, abstract))
}
