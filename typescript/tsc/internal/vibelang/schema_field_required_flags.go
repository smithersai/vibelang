package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaRequiredFields)
	ls.RegisterCodeFixProvider(schemaRequiredFieldExpansionFix)
}

// Detail 132: source-required struct fields must remain present. A named
// optional-key schema must not silently make a required field optional.
// Readonly-key enforcement and direct schema-error fields are separate rules.
func checkSchemaRequiredFields(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isSchemaStruct(n) {
			for _, property := range n.Arguments()[0].AsObjectLiteralExpression().Properties.Nodes {
				if !ast.IsPropertyAssignment(property) {
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

// Reuse the byte-identical namespace, bounded printer and error-field
// expansion helpers supplied by the tuple/record fixes. This provider has its
// own diagnostic filter, so it does not alter their queued source.
var schemaRequiredFieldExpansionFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || !strings.HasPrefix(fix.Diagnostic.Message.AsString(), "A required schema field") {
			return nil, nil
		}
		// Generated derived-error ranges can end before nested field codecs.
		var value *ast.Node
		var find func(*ast.Node) bool
		find = func(node *ast.Node) bool {
			if ast.IsEntityNameExpression(node) && node.Flags&ast.NodeFlagsReparsed == 0 &&
				nodeStart(fix.SourceFile, node) == fix.Span.Pos() && node.End() == fix.Span.End() {
				value = node
				return true
			}
			return node.ForEachChild(find)
		}
		fix.SourceFile.AsNode().ForEachChild(find)
		if value == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		var fields *ast.Node
		for node := value; node != nil; node = node.Parent {
			if isSchemaErrorFields(node) {
				fields = node
			}
			if ast.IsVariableDeclaration(node) && node.Initializer() != nil && (isSchemaAlias(node) || isSchemaStruct(node.Initializer())) {
				statement := node.Parent.Parent
				if !ast.IsVariableStatement(statement) {
					return nil, nil
				}
				prefix := ""
				for _, m := range statement.ModifierNodes() {
					if m.Kind != ast.KindExportKeyword {
						return nil, nil
					}
					prefix = "export "
				}
				start := nodeStart(fix.SourceFile, statement)
				alias, scopeEdits := schemaFlagNamespace(c, fix, node, start)
				expression := schemaFlagExpression(fix.SourceFile, node.Initializer(), alias, start, statement.End())
				indent := lineIndent(fix.SourceFile.Text(), start)
				name := node.Name().Text()
				text := prefix + "const " + name + " = " + expression + ";\n" + indent + prefix + "type " + name + " = typeof " + name + ".Type;"
				edits := append(replaceRange(fix, start, statement.End(), text), scopeEdits...)
				return []*ls.CodeAction{{Description: "Write the schema with explicit Effect codecs", Changes: edits}}, nil
			}
			if fields != nil && ast.IsClassDeclaration(node) {
				if edits := schemaErrorFlagExpansion(c, fix, node, fields); len(edits) > 0 {
					return []*ls.CodeAction{{Description: "Write the schema with explicit Effect codecs", Changes: edits}}, nil
				}
				return nil, nil
			}
		}
		return nil, nil
	},
}
