package compiler

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// SyntacticDiagnosticsHook supplies language-specific syntax diagnostics that
// need the program's imports or types to describe the preserving migration.
// It must not change the parsed file or its native diagnostics.
type SyntacticDiagnosticsHook func(context.Context, *Program, *ast.SourceFile) []*ast.Diagnostic

var syntacticDiagnosticsHooks []SyntacticDiagnosticsHook

// RegisterSyntacticDiagnosticsHook registers an in-tree language extension.
// Like other compiler extension hooks, registration happens only during init.
func RegisterSyntacticDiagnosticsHook(hook SyntacticDiagnosticsHook) {
	syntacticDiagnosticsHooks = append(syntacticDiagnosticsHooks, hook)
}
