package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// checkDoControlFlow keeps the parser's do expression diagnostics. The
// mapper reads each do expression as its function (VibeLangDoAsFunction),
// so the parser rejects a return, var, jump, await or yield that would
// leave one, and neither rendering gives rejected do code meaning.
func (p *projector) checkDoControlFlow() {
	for _, d := range p.file.Diagnostics() {
		switch d.Code() {
		case parser.DoEndsCode, parser.DoLoopHeadCode, parser.DoParameterVarCode, parser.DoBoundaryCode:
			p.diagnostics = append(p.diagnostics, Diagnostic{Start: d.Pos(), Length: d.End() - d.Pos(), Code: d.Code(), Message: d.Localize(locale.Default)})
		}
	}
}
