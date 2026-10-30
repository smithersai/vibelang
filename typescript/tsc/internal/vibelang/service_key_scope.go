package vibelang

import (
	"encoding/json"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
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

func explicitServiceKeyRewrite(c *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	class := name.Parent
	if !serviceNeedsExplicitKey(c, class) {
		return nil
	}
	key, _ := json.Marshal(servicesFor(c).key(class))
	declaration := "static readonly key = " + string(key)
	at := class.ClassLikeData().Members.Pos()
	if at > 0 && at <= len(file.Text()) && file.Text()[at-1] == '{' {
		return &formRewrite{description: declaration, edits: []sourceEdit{{at, at, " " + declaration + ";"}}}
	}
	if serviceShape(class) != nil {
		return &formRewrite{description: declaration, edits: []sourceEdit{{class.End(), class.End(), " { " + declaration + " }"}}}
	}
	return nil
}

func checkExplicitServiceKeys(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if serviceNeedsExplicitKey(c, node) {
			d := report(c, node.Name(), serviceExplicitKeyDiagnostic)
			if rewrite := explicitServiceKeyRewrite(c, file, node.Name()); rewrite.fixable() {
				note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", rewrite.description)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func init() {
	registry[serviceExplicitKeyDiagnostic.Code] = serviceExplicitKeyDiagnostic
	fileChecks = append(fileChecks, checkExplicitServiceKeys)
	tsFormFixCodes = append(tsFormFixCodes, serviceExplicitKeyDiagnostic.Code)
	tsFormRules[serviceExplicitKeyDiagnostic.Code] = &tsFormRule{
		message: serviceExplicitKeyDiagnostic,
		plan:    explicitServiceKeyRewrite,
		diagnosed: func(n *ast.Node) bool {
			return ast.IsIdentifier(n) && n.Parent != nil && ast.IsClassDeclaration(n.Parent) && n.Parent.Name() == n
		},
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{serviceExplicitKeyDiagnostic.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}
