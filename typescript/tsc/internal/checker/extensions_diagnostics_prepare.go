package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// DiagnosticsPreparationHook runs after the file is fully checked and before
// diagnostics are collected. It may add semantic diagnostics even when the
// caller is collecting suggestions, and may request other checked files.
// Registration is confined to in-tree initialization, as for other hooks.
type DiagnosticsPreparationHook func(*Checker, *ast.SourceFile)

var diagnosticsPreparationHooks []DiagnosticsPreparationHook

func RegisterDiagnosticsPreparationHook(hook DiagnosticsPreparationHook) {
	diagnosticsPreparationHooks = append(diagnosticsPreparationHooks, hook)
}

func prepareExtensionDiagnostics(c *Checker, file *ast.SourceFile) {
	for _, hook := range diagnosticsPreparationHooks {
		hook(c, file)
	}
}
