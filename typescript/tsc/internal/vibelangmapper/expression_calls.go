package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

func (p *projector) formChoice(at *ast.Node, message string) {
	start := p.tokenStart(at)
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: max(0, at.End()-start), Code: CodeFormChoice, Message: message})
}
