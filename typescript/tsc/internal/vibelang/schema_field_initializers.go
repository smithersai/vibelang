package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaFieldInitializers)
	registerNativeSchemaFix(1247)
	ls.RegisterCodeFixProvider(schemaFieldInitializerFix)
}

type schemaFieldInitializerSite struct {
	expression core.TextRange
	removal    core.TextRange
	trivia     string
}

// Schema fields are type members, not property declarations with defaults.
// Struct lowering used only the type, so removing an initializer preserves
// the old codec and does not evaluate the discarded expression.
func schemaFieldInitializerSites(file *ast.SourceFile) []schemaFieldInitializerSite {
	var bodies []core.TextRange
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if isSchemaStruct(node) {
			bodies = append(bodies, node.Arguments()[0].Loc)
			return false
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	const prefix = "type $SchemaFields = "
	var sites []schemaFieldInitializerSite
	for _, body := range bodies {
		if body.Pos() < 0 || body.End() > len(file.Text()) {
			continue
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-initializer.vibe", PathKey: "/schema-initializer.vibe"}, prefix+file.Text()[body.Pos():body.End()], core.ScriptKindTS)
		offset := body.Pos() - len(prefix)
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsPropertySignatureDeclaration(node) && node.Initializer() != nil && node.Type() != nil {
				initializer := node.Initializer()
				span := scanner.GetErrorRangeForNode(raw, initializer)
				equals := scanner.SkipTrivia(raw.Text(), node.Type().End())
				start := scanner.SkipTrivia(raw.Text(), initializer.Pos())
				if equals < start && raw.Text()[equals] == '=' {
					sites = append(sites, schemaFieldInitializerSite{
						expression: core.NewTextRange(span.Pos()+offset, span.End()+offset),
						removal:    core.NewTextRange(equals+offset, initializer.End()+offset),
						trivia:     raw.Text()[equals+1 : start],
					})
				}
			}
			return node.ForEachChild(visit)
		}
		raw.AsNode().ForEachChild(visit)
	}
	return sites
}

func checkSchemaFieldInitializers(c *checker.Checker, file *ast.SourceFile) {
	for _, site := range schemaFieldInitializerSites(file) {
		c.AddDiagnostic(ast.NewDiagnostic(file, site.expression, diagnostics.A_type_literal_property_cannot_have_an_initializer))
	}
}

var schemaFieldInitializerFix = &ls.CodeFixProvider{
	Source:     "",
	ErrorCodes: []int32{1247},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil {
			return nil, nil
		}
		for _, site := range schemaFieldInitializerSites(fix.SourceFile) {
			if site.expression == fix.Span {
				return []*ls.CodeAction{{Description: "Write the schema field without an ignored initializer", Changes: replaceRange(fix, site.removal.Pos(), site.removal.End(), site.trivia)}}, nil
			}
		}
		return nil, nil
	},
}
