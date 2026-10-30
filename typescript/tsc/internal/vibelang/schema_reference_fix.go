package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() { ls.RegisterCodeFixProvider(schemaAliasReferenceFix) }

// A non-schema alias with a public Type member previously emitted this plain
// const/type pair. Expanding it preserves that value and public declaration.
var schemaAliasReferenceFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		value := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			return node.Parent != nil && isSchemaAlias(node.Parent) &&
				node.Parent.Initializer() == node && ast.IsEntityNameExpression(node) &&
				node.Flags&ast.NodeFlagsReparsed == 0
		})
		if value == nil {
			return nil, nil
		}
		declaration := value.Parent
		statement := declaration.Parent.Parent
		if !ast.IsVariableStatement(statement) {
			return nil, nil
		}
		prefix := ""
		for _, modifier := range statement.ModifierNodes() {
			if modifier.Kind != ast.KindExportKeyword {
				return nil, nil
			}
			prefix = "export "
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		t := c.GetTypeAtLocation(value)
		if t == nil || isSchemaValue(c, t) {
			return nil, nil
		}
		member := c.GetPropertyOfType(c.GetApparentType(t), "Type")
		if member == nil {
			return nil, nil
		}
		for _, d := range member.Declarations() {
			if ast.HasSyntacticModifier(d, ast.ModifierFlagsPrivate|ast.ModifierFlagsProtected) {
				return nil, nil
			}
		}
		file := fix.SourceFile
		start := nodeStart(file, statement)
		original := file.Text()[start:statement.End()]
		if strings.Contains(original, "//") || strings.Contains(original, "/*") {
			return nil, nil
		}
		name := declaration.Name().Text()
		indent := lineIndent(file.Text(), start)
		text := prefix + "const " + name + " = " + expressionText(file, value) + ";\n" +
			indent + prefix + "type " + name + " = typeof " + name + ".Type;"
		return []*ls.CodeAction{{
			Description: "Write the non-schema alias as a const and type",
			Changes:     replaceRange(fix, start, statement.End(), text),
		}}, nil
	},
}
