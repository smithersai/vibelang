package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
