package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var serviceExplicitKeyDiagnostic = message(903, errorCategory, "This service has no derived key in this scope. Write static readonly key initialized with a string literal.")

func serviceNeedsExplicitKey(c *checker.Checker, class *ast.Node) bool {
	if !ast.IsClassDeclaration(class) || class.Name() == nil || declarationWord(class) != "service" {
		return false
	}
	for _, member := range class.Members() {
		if ast.IsPropertyDeclaration(member) && ast.IsStatic(member) && member.Name() != nil &&
			ast.IsIdentifier(member.Name()) && member.Name().Text() == "key" {
			return false // Invalid written keys have their own diagnostic.
		}
	}
	return !serviceCanDeriveKey(c, class)
}

// serviceCanDeriveKey also guides Context.Service migration: a matching old
// fallback key must remain explicit when its new declaration cannot derive one.
func serviceCanDeriveKey(c *checker.Checker, class *ast.Node) bool {
	for parent := class.Parent; parent != nil; parent = parent.Parent {
		switch parent.Kind {
		case ast.KindSourceFile:
			file := ast.GetSourceFileOfNode(class)
			program := c.Program()
			directory := program.GetNearestAncestorDirectoryWithPackageJson(file.FileName().Directory())
			if directory == "" {
				return false
			}
			info := program.GetPackageJsonInfo(directory.ResolveFile("package.json"))
			if !info.Exists() {
				return false
			}
			_, named := info.Contents.Name.GetValue()
			return named
		case ast.KindModuleBlock, ast.KindModuleDeclaration:
		default:
			return false
		}
	}
	return false
}

func checkExplicitServiceKeys(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if serviceNeedsExplicitKey(c, node) {
			report(c, node.Name(), serviceExplicitKeyDiagnostic)

		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func init() {
	registry[serviceExplicitKeyDiagnostic.Code] = serviceExplicitKeyDiagnostic
	fileChecks = append(fileChecks, checkExplicitServiceKeys)
	tsFormRules[serviceExplicitKeyDiagnostic.Code] = &tsFormRule{
		message: serviceExplicitKeyDiagnostic,
	}
}
