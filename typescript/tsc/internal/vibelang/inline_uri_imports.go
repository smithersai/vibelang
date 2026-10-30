package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var inlineURIModuleDiagnostic = EK0107.With("A {0} module supplies code in a string; move its import to a .ts file.")

func init() { fileChecks = append(fileChecks, checkInlineURIModules) }

// VIP-33/detail 74 rejects literal data/blob programs independently of the
// Promise bridge around a dynamic import. Computed specifiers and erased
// import-type queries retain their TypeScript meaning.
func checkInlineURIModules(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var specifier *ast.Node
		switch {
		case ast.IsImportDeclaration(node) || ast.IsExportDeclaration(node):
			specifier = node.ModuleSpecifier()
		case ast.IsImportCall(node):
			if args := node.Arguments(); len(args) > 0 {
				specifier = args[0]
			}
		}
		if specifier != nil && ast.IsStringLiteral(specifier) {
			if scheme := inlineModuleScheme(specifier.Text()); scheme != "" {
				report(c, specifier, inlineURIModuleDiagnostic, scheme)
				cover(c, specifier)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// URL parsing removes leading C0/space and ASCII tabs/newlines in the scheme.
// Inspect only the scheme so a large data payload does not need copying.
func inlineModuleScheme(specifier string) string {
	value := strings.TrimLeftFunc(specifier, func(r rune) bool { return r <= 0x20 })
	scheme, _, colon := strings.Cut(value, ":")
	if !colon {
		return ""
	}
	scheme = strings.Map(func(r rune) rune {
		if r == '\t' || r == '\r' || r == '\n' {
			return -1
		}
		return r
	}, scheme)
	for _, banned := range []string{"data", "blob"} {
		if strings.EqualFold(scheme, banned) {
			return banned + ":"
		}
	}
	return ""
}
