package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// checkDoControlFlow keeps the parser's do-expression and throw-lookahead diagnostics. The
// mapper reads each do expression as its function (VibeLangDoAsFunction),
// so the parser rejects a return, var, jump, await or yield that would
// leave one, and neither rendering gives rejected do code meaning.
func (p *projector) checkDoControlFlow() {
	for _, d := range p.file.Diagnostics() {
		if d.Source() != "EK" {
			continue // Native TS1010 (an unfinished comment) is not EK1010.
		}
		switch d.Code() {
		case parser.DoEndsCode, parser.DoLoopHeadCode, parser.DoParameterVarCode, parser.DoBoundaryCode,
			parser.VibeLangThrowLookaheadCode: // the throw-expression punctuator lookahead (VIP-40)
			p.diagnostics = append(p.diagnostics, Diagnostic{Start: d.Pos(), Length: d.End() - d.Pos(), Code: d.Code(), Message: d.Localize(locale.Default)})
		}
	}
}
