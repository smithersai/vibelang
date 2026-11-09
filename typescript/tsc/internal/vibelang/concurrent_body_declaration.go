package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// recoverableNativeSyntax reports whether d is a TypeScript grammar error that
// the VibeLang parser reports in the checker's place. The parser writes a
// block around a for concurrent body, which hides a declaration standing as
// the body from the checker's TS1156, so the parser reports it
// (parseVibeLangConcurrentFor). TypeScript's own parser never reports TS1156,
// and the declaration is parsed as written, so the file's semantic
// diagnostics are reported with it, as tsc reports them for a native loop.
func recoverableNativeSyntax(d *ast.Diagnostic) bool {
	return d.Source() != diagnosticSource && d.Code() == diagnostics.X_0_declarations_can_only_be_declared_inside_a_block.Code()
}
