package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// checkSchemaTaggedUnion validates every variant body of a `schema data`
// declaration (VIP-74): rejecting reserved `_tag` fields (EK1601) and
// checking each field's schema expression with VIP-15's schema rules.
func checkSchemaTaggedUnion(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	if len(call.Arguments()) == 0 || call.Arguments()[0].Kind != ast.KindObjectLiteralExpression {
		return
	}
	for _, variant := range call.Arguments()[0].AsObjectLiteralExpression().Properties.Nodes {
		if !ast.IsPropertyAssignment(variant) {
			continue
		}
		fields := variant.Initializer()
		if fields == nil || fields.Kind != ast.KindObjectLiteralExpression || fields.Flags&ast.NodeFlagsReparsed != 0 {
			continue
		}
		for _, prop := range fields.AsObjectLiteralExpression().Properties.Nodes {
			if !ast.IsPropertyAssignment(prop) {
				continue
			}
			if prop.Name() != nil && dataFieldHasTagName(c, prop.Name()) {
				report(c, prop.Name(), EK1601)
			}
			checkSchemaValue(c, file, prop.Initializer(), call)
		}
	}
}

// isSchemaTaggedUnionFields reports whether node is the field-schema object
// literal of one variant inside a `schema data` declaration.
func isSchemaTaggedUnionFields(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindObjectLiteralExpression || node.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	prop := node.Parent
	if prop == nil || !ast.IsPropertyAssignment(prop) || prop.Parent == nil {
		return false
	}
	return parser.IsSchemaTaggedUnion(prop.Parent.Parent)
}
