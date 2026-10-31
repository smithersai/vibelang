package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VibeLangServiceHeritageMessage is shared by the parser and EK registry.
const VibeLangServiceHeritageMessage = "A `service` declaration cannot have an `extends` or `implements` clause: a service's identity is its key. Compose shapes with types, such as `find: Base.Shape[\"find\"]`."

// skipVibeLangServiceHeritage reports EK0904 at each extends or implements
// clause of a service declaration and parses past it, so the body still
// parses as the service's (VIP-9). The clauses are dropped: a service has no
// base, and a heritage clause on the class would read as a control's.
func (p *Parser) skipVibeLangServiceHeritage() {
	for p.isHeritageClause() {
		p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, p.tokenRange(), "EK", diagnostics.CategoryError, 904, VibeLangServiceHeritageMessage))
		p.hasParseError = true
		p.parseHeritageClause(false /*isInterface*/)
	}
}
