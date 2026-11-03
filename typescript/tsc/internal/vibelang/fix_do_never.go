package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Old do expressions without a normal completion leaked any through their
// generated temporary. Preserve uses which relied on that type by making the
// old any explicit. The assertion erases; outward control flow stays in place.
func doNeverMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	diagnostics := program.GetSemanticDiagnostics(ctx, file)
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	seen := map[*ast.Node]bool{}
	for _, d := range diagnostics {
		if d.Source() != "" || refused[fixKey(file, d)] {
			continue
		}
		switch d.Code() {
		case 2339, 2349, 2351, 2358, 2407, 2488, 2698:
		default:
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if nodeStart(file, n) <= d.Pos() && n.End() >= d.End() {
				var value *ast.Node
				switch n.Kind {
				case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression, ast.KindNewExpression,
					ast.KindSpreadElement, ast.KindSpreadAssignment, ast.KindForOfStatement, ast.KindForInStatement:
					value = n.Expression()
				case ast.KindTaggedTemplateExpression:
					value = n.AsTaggedTemplateExpression().Tag
				case ast.KindBinaryExpression:
					if d.Code() == 2358 && n.AsBinaryExpression().OperatorToken.Kind == ast.KindInstanceOfKeyword {
						value = n.AsBinaryExpression().Left
					}
				}
				if value != nil {
					if source := doNeverSource(c, file, value, map[*ast.Node]bool{}); source != nil && !seen[source] {
						seen[source] = true
						start := scanner.SkipTrivia(file.Text(), source.Pos())
						result.fixes = append(result.fixes, fileFix{key: fixKey(file, d), code: d.Code(), label: "do result type", edits: []sourceEdit{
							{start, start, "("}, {source.End(), source.End(), " as any)"},
						}})
						return false
					}
				}
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	}
	return result
}

func doNeverSource(c *checker.Checker, file *ast.SourceFile, value *ast.Node, seen map[*ast.Node]bool) *ast.Node {
	value = ast.SkipParentheses(value)
	if seen[value] || c.GetTypeAtLocation(value).Flags()&checker.TypeFlagsNever == 0 {
		return nil
	}
	seen[value] = true
	start := scanner.SkipTrivia(file.Text(), value.Pos())
	if value.Flags&ast.NodeFlagsReparsed != 0 && start+2 < value.End() && strings.HasPrefix(file.Text()[start:value.End()], "do") {
		open := scanner.SkipTrivia(file.Text(), start+2)
		if open < value.End() && file.Text()[open] == '{' {
			return value
		}
	}
	if ast.IsIdentifier(value) {
		if symbol := c.GetSymbolAtLocation(value); symbol != nil {
			declaration := symbol.ValueDeclaration()
			if declaration != nil && ast.GetSourceFileOfNode(declaration) == file && ast.IsVariableDeclaration(declaration) && declaration.Type() == nil && declaration.Initializer() != nil {
				return doNeverSource(c, file, declaration.Initializer(), seen)
			}
		}
	}
	return nil
}
