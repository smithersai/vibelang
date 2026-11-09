package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaRequiredFields)
}

// Detail 132: source-required struct fields must remain present. A named
// optional-key schema must not silently make a required field optional.
// Readonly-key enforcement is separate; schema errors share the field checks.
func checkSchemaRequiredFields(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if fields := schemaMappedFieldObject(n); fields != nil {
			for _, property := range fields.AsObjectLiteralExpression().Properties.Nodes {
				if !ast.IsPropertyAssignment(property) || property.Name() == nil || property.Name().Flags&ast.NodeFlagsReparsed != 0 {
					continue
				}
				value := property.Initializer()
				for sourceSchemaFieldModifier(value, "mutableKey") {
					value = value.Arguments()[0]
				}
				if sourceSchemaFieldModifier(value, "optional") {
					continue
				}
				if known, required := schemaStructValueRequired(c, value); known && !required {
					d := report(c, value, EK2109.With("A required schema field must use a schema whose decoded key is required. Use an unmodified value schema and write optionality on the field."))
					note(d, "Keep an explicit Schema.Struct value when the reference's optional-key behavior is intended.")
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func sourceSchemaFieldModifier(n *ast.Node, name string) bool {
	if !ast.IsCallExpression(n) || len(n.Arguments()) != 1 {
		return false
	}
	callee := n.Expression()
	return ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == name &&
		ast.IsIdentifier(callee.Expression()) && callee.Expression().Text() == "Schema" &&
		callee.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}

func schemaStructValueRequired(c *checker.Checker, value *ast.Node) (known, required bool) {
	t := c.GetTypeAtLocation(value)
	if !isSchemaValue(c, t) {
		return false, false
	}
	flag := c.GetTypeOfPropertyOfType(t, "~type.optionality")
	return true, flag != nil && flag.IsStringLiteral() && flag.AsLiteralType().Value() == "required"
}
