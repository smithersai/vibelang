package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A module that two of effect's subpath packages list is not in scope
// (VIP-14, detail 55): EK1401 names every exporter, so the
// program imports the one it means.
var namespaceAmbiguityDiagnostic = message(1401, errorCategory, "{0} is exported by {1}, so it needs an explicit import. Choose one: {2}.")

func init() {
	registry[namespaceAmbiguityDiagnostic.Code] = namespaceAmbiguityDiagnostic
	checker.RegisterDiagnosticsFilterHook(explainMissingEffectName)
}

func explainMissingEffectName(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || (d.Code() != 2304 && d.Code() != 2503 && d.Code() != 2552) {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil || !ast.IsIdentifier(name) {
			continue
		}
		if c.ResolveName(name.Text(), name, ast.SymbolFlagsValue|ast.SymbolFlagsType|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false) != nil {
			continue // an explicit local/imported binding shadows the implicit namespace
		}
		if packages := effectSubpathShared[name.Text()]; len(packages) > 0 {
			imports := make([]string, len(packages))
			for j, p := range packages {
				imports[j] = "import { " + name.Text() + " } from \"" + p + "\""
			}
			all[i] = newDiagnosticAt(optionsFor(c, file), file, d.Loc(), namespaceAmbiguityDiagnostic, name.Text(), strings.Join(packages, " and "), strings.Join(imports, "; "))
		}
	}
	return all
}
