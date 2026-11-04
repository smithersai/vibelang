package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"slices"
)

var (
	EK1506 = message(1506, errorCategory, parser.VibeLangAmbientSchemaMessage)
	EK1607 = message(1607, errorCategory, parser.VibeLangAmbientDataMessage)
)

func init() {
	registry[EK1506.Code] = EK1506
	registry[EK1607.Code] = EK1607
	fileChecks = append(fileChecks, checkAmbientSchemaData)
	checker.RegisterDiagnosticsFilterHook(filterAmbientSchemaDataInitializers)
}

func checkAmbientSchemaData(c *checker.Checker, file *ast.SourceFile) {
	// Most files have no ambient value declaration. Do not reparse them.
	var ambient func(*ast.Node) bool
	ambient = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsAmbient != 0 && (ast.IsVariableStatement(node) || parser.IsDataDeclaration(node)) {
			return true
		}
		return node.ForEachChild(ambient)
	}
	if !file.AsNode().ForEachChild(ambient) {
		return
	}
	// Index each generated value initializer by its declared name's source end.
	// Source declarations nested inside a key have different name ranges.
	initializers := map[int][]int{}
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if ast.IsVariableDeclaration(node) && node.Name() != nil && node.Initializer() != nil && node.Initializer().Pos() >= 0 && node.Initializer().Pos() <= len(file.Text()) {
			initializers[node.Name().End()] = append(initializers[node.Name().End()], scanner.SkipTrivia(file.Text(), node.Initializer().Pos()))
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	_, forms := parser.ParseVibeLangSyntax(file.ParseOptions(), file.Text())
	for _, form := range forms {
		if !form.Ambient || form.Kind != parser.VibeSyntaxDeclaration {
			continue
		}
		message, width := EK1506, len("schema")
		switch form.Name {
		case "schema", parser.VibeSyntaxSchemaAlias:
		case parser.VibeSyntaxData:
			message, width = EK1607, len("data")
		default:
			continue
		}
		reportAt(c, file, core.NewTextRange(form.Head.Pos(), form.Head.Pos()+width), message)
		// Only the generated initializer is explained by the contextual error.
		// Keep independent native grammar and type errors, even inside the body.
		positions := ambientSchemaDataInitializerPositions(c)
		for _, pos := range initializers[form.Head.End()] {
			positions[ambientSchemaDataInitializer{file, pos}] = true
		}
	}
}

type ambientSchemaDataInitializer struct {
	file *ast.SourceFile
	pos  int
}
type ambientSchemaDataInitializerKey struct{}

func ambientSchemaDataInitializerPositions(c *checker.Checker) map[ambientSchemaDataInitializer]bool {
	return c.ExtensionState(ambientSchemaDataInitializerKey{}, func() any { return map[ambientSchemaDataInitializer]bool{} }).(map[ambientSchemaDataInitializer]bool)
}

func filterAmbientSchemaDataInitializers(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	positions := ambientSchemaDataInitializerPositions(c)
	if len(positions) == 0 {
		return all
	}
	return slices.DeleteFunc(slices.Clone(all), func(d *ast.Diagnostic) bool {
		return d.Source() == "" && (d.Code() == 1039 || d.Code() == 1254) && positions[ambientSchemaDataInitializer{file, d.Pos()}]
	})
}
