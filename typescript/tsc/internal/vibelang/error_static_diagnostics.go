package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK1302 owns native static-member shape errors. Match the diagnostic's exact
// name range: containment would also hide errors in a computed key's expression
// or in a nested class inside a method, which remain independent.
func filterErrorStaticShapeDiagnostics(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	owned := map[core.TextRange][]int32{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			for _, member := range node.Members() {
				if member.Flags&ast.NodeFlagsReparsed != 0 || !ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) || errorMemberIsTag(member) || member.Name() == nil {
					continue
				}
				name := member.Name()
				at := scanner.GetErrorRangeForNode(file, name)
				owned[at] = append(owned[at], 2699, 4113, 4114, 4117)
				// Static-side incompatibility is reported at the enclosing class's name.
				atClass := scanner.GetErrorRangeForNode(file, node.Name())
				owned[atClass] = append(owned[atClass], 2417)
				prototype := (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) && name.Text() == "prototype"
				if ast.IsComputedPropertyName(name) {
					typ := c.GetTypeAtLocation(name.Expression())
					prototype = typ != nil && checker.IsTypeUsableAsPropertyName(typ) && checker.GetPropertyNameFromType(typ) == "prototype"
				}
				if prototype {
					owned[at] = append(owned[at], 2322)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return slices.DeleteFunc(slices.Clone(all), func(d *ast.Diagnostic) bool {
		return d.Source() == "" && slices.Contains(owned[core.NewTextRange(d.Pos(), d.End())], d.Code())
	})
}
