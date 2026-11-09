package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-13/29, decided detail248: custom error declarations construct runtime
// values. Native TypeScript ambient classes retain their erased meaning.
var EK1307 = message(1307, errorCategory, "An error declaration needs a runtime constructor and cannot be ambient. Write a native TypeScript ambient class, or move the declaration to nonambient code.")

func init() {
	registry[EK1307.Code] = EK1307
	fileChecks = append(fileChecks, checkAmbientErrorDeclarations)
	checker.RegisterDiagnosticsFilterHook(filterAmbientErrorDeclarationDiagnostics)
}

func checkAmbientErrorDeclarations(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); form != errorFormNone && node.Flags&ast.NodeFlagsAmbient != 0 {
			report(c, node.Name(), EK1307)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// Ambient rejection precedes the declaration/body categories. Keep native
// type errors and schema-field diagnostics: they are independent of whether
// this runtime declaration belongs in an ambient context.
func filterAmbientErrorDeclarationDiagnostics(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	var ambient []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); form != errorFormNone && node.Flags&ast.NodeFlagsAmbient != 0 {
			ambient = append(ambient, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if len(ambient) == 0 {
		return all
	}
	return slices.DeleteFunc(slices.Clone(all), func(d *ast.Diagnostic) bool {
		owned := false
		if d.Source() == diagnosticSource {
			switch d.Code() {
			case 1301, 1302, 1303, 1304, 1306, 2117, 2118:
				owned = true
			}
		} else if d.Source() == "" {
			// These codes only reject runtime code in an ambient context.
			// EK1307 already explains that context for the whole declaration.
			owned = d.Code() == 1039 || d.Code() == 1183 || d.Code() == 1036
		}
		return owned && slices.ContainsFunc(ambient, func(node *ast.Node) bool {
			return node.Pos() <= d.Pos() && d.End() <= node.End()
		})
	})
}
