package parser

import (
 "github.com/microsoft/TypeScript/tsc/internal/ast"
 "github.com/microsoft/TypeScript/tsc/internal/core"
 "github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Shared reporter for declaration recoveries; published header handlers remain in place.
func (p *Parser) vibelangDeclarationError(loc core.TextRange, code int32, message string) {
 p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, loc, "EK", diagnostics.CategoryError, code, message))
 p.hasParseError = true
}
