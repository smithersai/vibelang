package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaReadonlyFields)
}

// Detail132 promises decoded readonly keys for explicitly readonly struct
// fields. Read modifiers from source: lowered fields have discarded them.
func checkSchemaReadonlyFields(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if fields := schemaMappedFieldObject(node); fields != nil {
			readonly := sourceSchemaReadonlyKeys(file, fields.Loc)
			for _, property := range fields.AsObjectLiteralExpression().Properties.Nodes {
				if !ast.IsPropertyAssignment(property) || property.Name() == nil || property.Name().Flags&ast.NodeFlagsReparsed != 0 || (!isSchemaErrorFields(fields) && !readonly[property.Name().Loc]) {
					continue
				}
				value := property.Initializer()
				for readonlyFieldSourceModifier(value) {
					value = value.Arguments()[0]
				}
				if known, immutable := schemaStructValueReadonly(c, value); known && !immutable {
					d := report(c, value, EK2109.With("A readonly schema field must use a schema whose decoded key is readonly. Use an unmodified value schema and write mutability on the field."))
					note(d, "Keep an explicit Schema.Struct value when the reference's mutable-key behavior is intended.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func sourceSchemaReadonlyKeys(file *ast.SourceFile, body core.TextRange) map[core.TextRange]bool {
	result := map[core.TextRange]bool{}
	if body.Pos() < 0 || body.End() > len(file.Text()) {
		return result
	}
	const prefix = "type $SchemaFields = "
	raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/readonly-fields.vibe", PathKey: "/readonly-fields.vibe"}, prefix+file.Text()[body.Pos():body.End()], core.ScriptKindTS)
	if len(raw.Statements.Nodes) != 1 || !ast.IsTypeAliasDeclaration(raw.Statements.Nodes[0]) {
		return result
	}
	literal := raw.Statements.Nodes[0].Type()
	if !ast.IsTypeLiteralNode(literal) {
		return result
	}
	offset := body.Pos() - len(prefix)
	for _, member := range literal.AsTypeLiteralNode().Members.Nodes {
		if !ast.IsPropertySignatureDeclaration(member) || member.Name() == nil {
			continue
		}
		for _, modifier := range member.ModifierNodes() {
			if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
				name := member.Name()
				result[core.NewTextRange(name.Pos()+offset, name.End()+offset)] = true
			}
		}
	}
	return result
}

func readonlyFieldSourceModifier(node *ast.Node) bool {
	if !ast.IsCallExpression(node) || len(node.Arguments()) != 1 {
		return false
	}
	callee := node.Expression()
	return ast.IsPropertyAccessExpression(callee) && (callee.Name().Text() == "optional" || callee.Name().Text() == "mutableKey") &&
		ast.IsIdentifier(callee.Expression()) && callee.Expression().Text() == "Schema" && callee.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}

func schemaStructValueReadonly(c *checker.Checker, value *ast.Node) (known, immutable bool) {
	t := c.GetTypeAtLocation(value)
	if !isSchemaValue(c, t) {
		return false, false
	}
	flag := c.GetTypeOfPropertyOfType(t, "~type.mutability")
	return true, flag != nil && flag.IsStringLiteral() && flag.AsLiteralType().Value() == "readonly"
}
