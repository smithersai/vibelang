package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Detail 149 applies decoded key flags at the mapped Record value, separately
// from the outer field's flags and the value's nested collection mutability.
func init() { fileChecks = append(fileChecks, checkSchemaRecordReferenceFlags) }

func checkSchemaRecordReferenceFlags(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if generatedSchemaRecordCall(c, node, "Record", 2) {
			value := node.Arguments()[1]
			readonly := true
			if generatedSchemaRecordCall(c, value, "mutableKey", 1) {
				readonly = false
				value = value.Arguments()[0]
			}
			if known, missing := schemaRecordValueMissingFlags(c, value, readonly); known && len(missing) != 0 {
				d := report(c, value, EK2109.With("The value schema of this Record must have a decoded key that is {0}. Use an unmodified value schema and write the modifiers on the Record type."), strings.Join(missing, " and "))
				if readonly {
					note(d, "An optional-key schema can omit finite record keys; a mutable-key schema can override a readonly record.")
				} else {
					note(d, "An optional-key schema can omit finite record keys. Use a required union with undefined when the key must be present.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func generatedSchemaRecordCall(c *checker.Checker, node *ast.Node, name string, count int) bool {
	return ast.IsCallExpression(node) && node.Flags&ast.NodeFlagsReparsed == 0 &&
		node.Expression().Flags&ast.NodeFlagsReparsed != 0 && isSchemaCall(c, node, name, count)
}

func schemaRecordValueMissingFlags(c *checker.Checker, value *ast.Node, readonly bool) (known bool, missing []string) {
	t := c.GetTypeAtLocation(value)
	if !isSchemaValue(c, t) {
		return false, nil
	}
	needs := func(property, wanted string) {
		flag := c.GetTypeOfPropertyOfType(t, property)
		if flag == nil || !flag.IsStringLiteral() || flag.AsLiteralType().Value() != wanted {
			missing = append(missing, wanted)
		}
	}
	needs("~type.optionality", "required")
	if readonly {
		needs("~type.mutability", "readonly")
	}
	return true, missing
}
