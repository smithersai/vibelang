package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK3501 = message(3501, errorCategory, parser.RetiredControlMessage)

func init() {
	registry[EK3501.Code] = EK3501
	fileChecks = append(fileChecks, checkRetiredContinuations)
}

// Source spellings do not decide a native identifier's meaning. Follow the
// actual runtime exports (including explicit import aliases and namespace
// members); a callback parameter called resume is an ordinary local binding.
func checkRetiredContinuations(c *checker.Checker, file *ast.SourceFile) {
	targets := relicContinuationTargets(c, file)
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsClassDeclaration(n) && declarationWord(n) == "control" {
			return false
		}
		if isHandleStatement(n) {
			return false
		}
		if ast.IsExportDeclaration(n) {
			d := n.AsExportDeclaration()
			if d.ModuleSpecifier != nil && (d.ExportClause == nil || d.ExportClause.Kind == ast.KindNamespaceExport) {
				if module := c.GetSymbolAtLocation(d.ModuleSpecifier); module != nil {
					for _, export := range c.GetExportsOfModule(aliasTarget(c, module)) {
						if targets[aliasTarget(c, export)] {
							report(c, n, EK3501)
							break
						}
					}
				}
			}
		}
		if ast.IsBindingElement(n) && n.Parent != nil && ast.IsObjectBindingPattern(n.Parent) {
			variable := n.Parent.Parent
			if variable != nil && ast.IsVariableDeclaration(variable) && variable.Initializer() != nil {
				name := n.PropertyName()
				if name == nil {
					name = n.Name()
				}
				receiver := c.GetTypeAtLocation(variable.Initializer())
				retired := false
				if name != nil && ast.IsComputedPropertyName(name) {
					retired = relicRetiredProperty(c, receiver, c.GetTypeAtLocation(name.Expression()), targets)
				} else if receiver != nil && name != nil && (ast.IsIdentifier(name) || ast.IsStringLiteralLike(name)) {
					symbol := c.GetPropertyOfType(receiver, name.Text())
					retired = symbol != nil && targets[aliasTarget(c, symbol)]
				}
				if retired {
					report(c, n, EK3501)
				}
			}
		}
		if n.Kind == ast.KindImportSpecifier || n.Kind == ast.KindExportSpecifier {
			symbol := c.GetSymbolAtLocation(n.Name())
			if symbol != nil && targets[aliasTarget(c, symbol)] {
				report(c, n, EK3501)
			}
			return false
		}
		if ast.IsIdentifier(n) || ast.IsElementAccessExpression(n) {
			if relicContinuationReference(c, n, targets) {
				report(c, n, EK3501)
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
