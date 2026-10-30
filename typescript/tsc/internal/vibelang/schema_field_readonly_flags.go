package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaReadonlyFields)
	ls.RegisterCodeFixProvider(schemaReadonlyFieldExpansionFix)
}

// Detail132 promises decoded readonly keys for explicitly readonly struct
// fields. Read modifiers from source: lowered fields have discarded them.
func checkSchemaReadonlyFields(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isSchemaStruct(node) {
			fields := node.Arguments()[0]
			readonly := sourceSchemaReadonlyKeys(file, fields.Loc)
			for _, property := range fields.AsObjectLiteralExpression().Properties.Nodes {
				if !ast.IsPropertyAssignment(property) || !readonly[property.Name().Loc] {
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

// Reuse the byte-identical namespace, bounded printer and error-field
// expansion helpers supplied by the tuple/record fixes. This provider has its
// own diagnostic filter, so it does not alter their queued source.
var schemaReadonlyFieldExpansionFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || !strings.HasPrefix(fix.Diagnostic.Message.AsString(), "A readonly schema field") {
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
