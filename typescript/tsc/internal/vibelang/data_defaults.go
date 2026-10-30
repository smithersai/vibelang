package vibelang

import (
	"context"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var dataDefault = EK2803.With("{0} cannot have a default in a data declaration. Write the default on a type alias; vibelang --fix expands this declaration to its Effect TypeScript.")

func init() {
	registry[EK2803.Code] = dataDefault
	tsFormFixCodes = append(tsFormFixCodes, EK2803.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2803.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source: diagnosticSource, ErrorCodes: []int32{EK2803.Code},
		GetCodeActions: dataDefaultActions,
	})
}

// Expand the exact TaggedEnum sugar rather than rename a data declaration:
// its type and constructor keep their names and generic behavior,
// including defaults. Preserve the helper used by the constructors.
func dataDefaultActions(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	var declaration *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsDataDeclaration(node) && node.Pos() <= fix.Span.Pos() && node.End() >= fix.Span.End() {
			declaration = node
			return true
		}
		return node.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if declaration == nil {
		return nil, nil
	}
	text := fix.SourceFile.Text()
	raw := func(n *ast.Node) string { return text[nodeStart(fix.SourceFile, n):n.End()] }
	parameters := declaration.TypeParameters()
	definition := dataDefinitionOf(declaration)
	if len(parameters) == 0 || len(parameters) > 4 || definition == nil {
		return nil, nil
	}
	found := false
	var parameterText, arguments []string
	slots := []string{"A", "B", "C", "D"}
	for i, parameter := range parameters {
		p := parameter.AsTypeParameterDeclaration()
		if p.Constraint != nil {
			return nil, nil
		}
		found = found || p.DefaultType != nil
		parameterText = append(parameterText, raw(parameter))
		arguments = append(arguments, "this[\""+slots[i]+"\"]")
	}
	if !found {
		return nil, nil
	}
	// Escaped source identifiers reserve the same names as their decoded spelling.
	module := freshSchemaFlagName(text, "$Data")
	exported := ""
	if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsExport) {
		exported = "export "
	}
	var variants []string
	for _, variant := range parser.DataVariants(declaration) {
		var fields []string
		for _, field := range variant.Type().AsTypeLiteralNode().Members.Nodes {
			if !ast.IsPropertySignatureDeclaration(field) || field.Type() == nil {
				return nil, nil
			}
			optional := ""
			if field.PostfixToken() != nil {
				optional = "?"
			}
			fields = append(fields, "readonly "+raw(field.Name())+optional+": "+raw(field.Type()))
		}
		variants = append(variants, raw(variant.Name())+": { "+strings.Join(fields, "; ")+" }")
	}
	name := declaration.Name().Text()
	helper := definition.Name().Text()
	source := exported + "type " + name + "<" + strings.Join(parameterText, ", ") + "> = " + module + ".TaggedEnum<{ " + strings.Join(variants, "; ") + " }>;\n"
	source += exported + "interface " + helper + " extends " + module + ".TaggedEnum.WithGenerics<" + strconv.Itoa(len(parameters)) + "> { readonly taggedEnum: " + name + "<" + strings.Join(arguments, ", ") + "> }\n"
	source += exported + "const " + name + " = " + module + ".taggedEnum<" + helper + ">();"
	// Keep hashbangs and directive prologues ahead of the new hygienic import.
	insertion := 0
	if strings.HasPrefix(text, "#!") {
		if end := strings.IndexByte(text, '\n'); end >= 0 {
			insertion = end + 1
		}
	}
	for _, statement := range fix.SourceFile.Statements.Nodes {
		if !ast.IsExpressionStatement(statement) || statement.Expression().Kind != ast.KindStringLiteral {
			break
		}
		insertion = statement.End()
	}
	importText := "\nimport * as " + module + " from \"effect/Data\";\n"
	start := nodeStart(fix.SourceFile, declaration)
	if insertion == start {
		source = importText + source
		return []*ls.CodeAction{{Description: "Write data defaults in Effect TypeScript", Changes: replaceRange(fix, start, declaration.End(), source)}}, nil
	}
	changes := replaceRange(fix, start, declaration.End(), source)
	changes = append(changes, replaceRange(fix, insertion, insertion, importText)...)
	return []*ls.CodeAction{{Description: "Write data defaults in Effect TypeScript", Changes: changes}}, nil
}
