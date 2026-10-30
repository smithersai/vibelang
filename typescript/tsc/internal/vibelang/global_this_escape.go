package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var globalThisEscapeDiagnostic = EK0107.With("Use globalThis only as the object of a statically named member access; move this use to a .ts file.")

func init() { fileChecks = append(fileChecks, checkGlobalThisEscapes) }

// Detail 73 preserves static member reads, including repeated .globalThis
// objects, but forbids copying the object or using a nonliteral key. Member
// availability and platform/eval checks remain the ordinary checks' job.
func checkGlobalThisEscapes(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ast.IsIdentifier(node) || node.Text() != "globalThis" {
			return node.ForEachChild(visit)
		}
		// A type query resolves value names but never reads their values.
		meaning := node
		for meaning.Parent != nil && ast.IsQualifiedName(meaning.Parent) {
			meaning = meaning.Parent
		}
		if meaning.Parent != nil && meaning.Parent.Kind == ast.KindTypeQuery {
			return false
		}
		shorthand := node.Parent != nil && node.Parent.Kind == ast.KindShorthandPropertyAssignment
		if !isValueUse(node) && !shorthand {
			return false
		}
		symbol := c.GetSymbolAtLocation(node)
		if shorthand {
			symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
		}
		if symbol == nil || symbol.Name() != "globalThis" || len(symbol.Declarations()) != 0 {
			return false // a local declaration, parameter or explicit import shadows it
		}
		value := node
		for {
			for value.Parent != nil && ast.IsParenthesizedExpression(value.Parent) {
				value = value.Parent
			}
			parent := value.Parent
			if parent != nil && (ast.IsPropertyAccessExpression(parent) || ast.IsElementAccessExpression(parent)) && parent.Expression() == value {
				name, known := "", false
				switch parent.Kind {
				case ast.KindPropertyAccessExpression:
					name, known = parent.Name().Text(), true
				case ast.KindElementAccessExpression:
					key := parent.AsElementAccessExpression().ArgumentExpression
					if key != nil && (ast.IsStringLiteral(key) || key.Kind == ast.KindNoSubstitutionTemplateLiteral) {
						name, known = key.Text(), true
					}
				}
				if name == "globalThis" {
					value = parent
					continue
				}
				if known {
					return false
				}
				if ast.IsPropertyAccessExpression(parent) || ast.IsElementAccessExpression(parent) {
					value = parent
				}
			}
			report(c, value, globalThisEscapeDiagnostic)
			cover(c, value)
			return false
		}
	}
	file.AsNode().ForEachChild(visit)
}
