package compiler

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// ProgramDiagnosticsHook reports project-wide language-extension errors.
// They are collected independently of checker allocation and file requests,
// and the project system publishes them on the configuration document.
type ProgramDiagnosticsHook func(*Program) []*ast.Diagnostic

var programDiagnosticsHooks []ProgramDiagnosticsHook

// RegisterProgramDiagnosticsHook is called only during in-tree initialization.
func RegisterProgramDiagnosticsHook(hook ProgramDiagnosticsHook) {
	programDiagnosticsHooks = append(programDiagnosticsHooks, hook)
}

func (p *Program) getExtensionProgramDiagnostics() []*ast.Diagnostic {
	p.extensionDiagnosticsOnce.Do(func() {
		for _, hook := range programDiagnosticsHooks {
			p.extensionDiagnostics = append(p.extensionDiagnostics, hook(p)...)
		}
	})
	return p.extensionDiagnostics
}
