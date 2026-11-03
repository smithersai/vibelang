package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// CallArgumentDiagnosticsFilterHook filters only overload applicability errors
// for call, after its arguments have been checked. Diagnostics from checking
// expressions inside the arguments are reported separately and are not passed
// to this hook. Filtering does not change overload selection or inferred types.
type CallArgumentDiagnosticsFilterHook func(c *Checker, call *ast.Node, diagnostics []*ast.Diagnostic) []*ast.Diagnostic

var callArgumentDiagnosticsFilterHooks []CallArgumentDiagnosticsFilterHook

// RegisterCallArgumentDiagnosticsFilterHook registers an in-tree language's
// ownership of generated call errors. Register only during package init.
func RegisterCallArgumentDiagnosticsFilterHook(hook CallArgumentDiagnosticsFilterHook) {
	callArgumentDiagnosticsFilterHooks = append(callArgumentDiagnosticsFilterHooks, hook)
}

func (c *Checker) filterCallArgumentDiagnostics(call *ast.Node, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	for _, hook := range callArgumentDiagnosticsFilterHooks {
		diagnostics = hook(c, call, diagnostics)
	}
	return diagnostics
}
