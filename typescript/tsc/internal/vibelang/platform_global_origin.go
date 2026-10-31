package vibelang

import (
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-33 classifies the resolved global's host declarations, not the source
// file kind of a type-only augmentation. A local or imported binding still
// shadows that global, and ECMAScript declarations retain their exemption.
func isPlatformGlobalBinding(c *checker.Checker, symbol *ast.Symbol) bool {
	if symbol == nil || c.GlobalSymbol(symbol.Name(), ast.SymbolFlagsValue) != symbol {
		return false
	}
	host := false
	for _, declaration := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(declaration)
		if file == nil {
			continue
		}
		if isLibFile(c, file) {
			name := path.Base(string(file.FileName()))
			if strings.HasPrefix(name, "lib.es") || strings.HasPrefix(name, "lib.decorators") {
				return false
			}
			host = host || strings.HasPrefix(name, "lib.dom") ||
				strings.HasPrefix(name, "lib.webworker") || name == "lib.scripthost.d.ts"
		} else if packageOf(c, file) == "@types/node" || isPlatformPackage(packageOf(c, file)) {
			host = true
		}
	}
	return host
}
