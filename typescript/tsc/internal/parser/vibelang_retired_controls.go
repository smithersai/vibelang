package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const RetiredControlMessage = "Handlers are outside the first release."
const RetiredSelectMessage = "select is outside the first release. Choose explicit Effect selection for the intended behavior."

// Recover old nodes for migration and tooling, while rejecting the source
// grammar even when semantic checking is disabled.
func (p *Parser) retiredControlForm(at core.TextRange, code int32, message string) {
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, at, "EK", diagnostics.CategoryError, code, message))
}
