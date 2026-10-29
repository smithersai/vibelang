package autoimport

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// IsSourceFileFromExternalLibrary implements checker.Program, which the Effect
// lint rules extend (tsc/internal/effecttsgo, patch 002). The method comes from
// Effect-TS/tsgo patch 018, whose other changes VibeLang does not carry.
func (r *aliasResolver) IsSourceFileFromExternalLibrary(file *ast.SourceFile) bool {
	return false
}
