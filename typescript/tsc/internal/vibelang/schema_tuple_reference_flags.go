package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Detail 137: a required tuple position must remain present even when its
// referenced schema carries optional-key metadata. Written optional positions
// keep their optional mapping; explicit Effect tuple calls keep Effect's API.
func init() { fileChecks = append(fileChecks, checkSchemaTupleReferenceFlags) }

func checkSchemaTupleReferenceFlags(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if generatedSchemaTupleCall(c, node, "Tuple", 1) {
			if elements := node.Arguments()[0]; ast.IsArrayLiteralExpression(elements) {
				for _, element := range elements.Elements() {
					checkRequiredSchemaTupleElement(c, element)
				}
			}
		}
		if generatedSchemaTupleCall(c, node, "TupleWithRest", 2) {
			if rest := node.Arguments()[1]; ast.IsArrayLiteralExpression(rest) {
				for i, element := range rest.Elements() {
					if i > 0 {
						checkRequiredSchemaTupleElement(c, element)
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func generatedSchemaTupleCall(c *checker.Checker, node *ast.Node, name string, arguments int) bool {
	return ast.IsCallExpression(node) && node.Flags&ast.NodeFlagsReparsed == 0 &&
		node.Expression().Flags&ast.NodeFlagsReparsed != 0 && isSchemaCall(c, node, name, arguments)
}

func checkRequiredSchemaTupleElement(c *checker.Checker, element *ast.Node) {
	if generatedSchemaTupleCall(c, element, "optional", 1) {
		return
	}
	known, required := schemaTupleElementRequired(c, element)
	if known && !required {
		d := report(c, element, EK2109.With("A required tuple position must use a schema whose decoded key is required. Use an unmodified value schema, or a required union with undefined for a present undefined element."))
		note(d, "An optional-key schema may omit this position. Keep the explicit Schema.Tuple value if that optional behavior is intended.")
	}
}

// Unions and aliases are inspected through their inferred schema flags.
// Missing schema identity keeps existing reference/cycle diagnostics in charge.
func schemaTupleElementRequired(c *checker.Checker, element *ast.Node) (known, required bool) {
	t := c.GetTypeAtLocation(element)
	if !isSchemaValue(c, t) {
		return false, false
	}
	flag := c.GetTypeOfPropertyOfType(t, "~type.optionality")
	return true, flag != nil && flag.IsStringLiteral() && flag.AsLiteralType().Value() == "required"
}
