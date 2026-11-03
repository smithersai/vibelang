package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK4841 (D474): a schema constant beside the type alias that names its
// Type, which a schema alias (D280) writes as one declaration:
//
//	export type Kind = typeof Kind.Type
//	export const Kind = Schema.Literals(["persistent", "incognito"])
//
//	export schema Kind = "persistent" | "incognito"
//
// The parser writes an alias back into the same two declarations, the
// constant's schema through D133's mapping (vibelang_schema_alias.go), so the
// rewrite keeps the program when the schema maps back as a struct field's
// does (schemaTypeText, EK4832's): Schema.Literals and Schema.Literal of
// literals, the keyword schemas, Schema.Union, Schema.Array, Schema.Tuple,
// Schema.Record, a struct inside one of them, and a name or a dotted name of
// another schema. The constant is a const with one binding, no type
// annotation and no modifier but export.
//
// The rewrite also keeps the module's declaration file, which a migration
// must leave as it was. A schema alias's declaration file lists its constant,
// then its type (D501, schemas_declarations.go), so the warning applies only
// where the source already says the same: the type alias, type Kind = typeof
// Kind.Type with the constant's export, is the statement just after the
// constant, neither has JSDoc, and the rewrite leaves every import in place.
// A type written before its constant keeps its form and draws nothing. So do
// a Schema.Struct constant, which is EK4832's; a refinement or a
// transformation, such as a pipe, a check, an annotation, Schema.NullOr or a
// brand, which no type writes (D133); and a schema with a comment inside.

// EK4841 (D474, D501): a schema constant just before its type alias. {0} is the name, {1} the declaration that writes both.
var EK4841 = message(4841, warningCategory, "{0} holds a schema and its type alias names its type; a schema alias writes both: {1}.")

func init() {
	registry[EK4841.Code] = EK4841
	tsFormMessages = append(tsFormMessages, EK4841)
	tsFormFixCodes = append(tsFormFixCodes, EK4841.Code)
	tsFormRules[EK4841.Code] = &tsFormRule{
		message:   EK4841,
		find:      findSchemaAliasConstants,
		plan:      schemaAliasRewrite,
		diagnosed: isSchemaConstantName,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4841.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// findSchemaAliasConstants reports EK4841 at each constant of file that a
// schema alias writes with its type.
func findSchemaAliasConstants(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsVariableStatement(node) && !inHatch(node) {
			declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
			if len(declarations) == 1 && isSchemaConstantName(declarations[0].Name()) {
				name := declarations[0].Name()
				if rewrite := schemaAliasRewrite(c, file, name); rewrite.fixable() {
					report(name, rewrite, name.Text(), rewrite.description)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// schemaAliasRewrite plans EK4841's fix for the constant name names.
func schemaAliasRewrite(c *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	declaration := name.Parent
	list := declaration.Parent
	statement := list.Parent
	if !ast.IsVariableStatement(statement) || list.Flags&ast.NodeFlagsConst == 0 || len(list.AsVariableDeclarationList().Declarations.Nodes) != 1 ||
		declaration.Type() != nil || declaration.AsVariableDeclaration().ExclamationToken != nil || ast.NodeIsMissing(declaration.Initializer()) ||
		statement.Flags&ast.NodeFlagsVibeLang != 0 || declaration.Flags&ast.NodeFlagsVibeLang != 0 || len(statement.JSDoc(file)) != 0 {
		return nil // a schema alias already sets NodeFlagsVibeLang; a missing initializer has no text
	}
	for _, modifier := range statement.ModifierNodes() {
		if modifier.Kind != ast.KindExportKeyword {
			return nil
		}
	}
	schema := declaration.Initializer()
	switch {
	case ast.IsCallExpression(schema):
		if schema.Flags&ast.NodeFlagsVibeLang != 0 || schema.Expression().Flags&ast.NodeFlagsReparsed != 0 || isSchemaCall(c, schema, "Struct", 1) {
			return nil // a schema declaration's struct, or EK4832's
		}
	case !ast.IsEntityNameExpression(schema):
		return nil
	}
	text := file.Text()
	if body := text[nodeStart(file, schema):schema.End()]; strings.Contains(body, "//") || strings.Contains(body, "/*") {
		return nil
	}
	typeText, ok := schemaTypeText(c, file, schema, lineIndent(text, nodeStart(file, statement)))
	if !ok || !aliasTypeAfter(file, statement, name.Text()) {
		return nil
	}
	edits, kept, ok := schemaTypeEdits(c, file, statement, name, ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport))
	if !ok || len(edits) != 1 && !kept {
		return nil // another type of the name
	}
	start := nodeStart(file, statement)
	if modifiers := statement.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
		start = scanner.SkipTrivia(text, modifiers.End())
	}
	declarationText := "schema " + name.Text() + " = " + typeText
	edits = append([]sourceEdit{{start, statement.End(), declarationText}}, edits...)
	rewrite := withImportRemovals(c, file, &formRewrite{edits: edits, description: shortText(declarationText, "schema "+name.Text()+" = …")})
	if len(rewrite.edits) != len(edits) {
		return nil // an import the declaration file names would go
	}
	return rewrite
}

// aliasTypeAfter reports whether the statement just after statement, in its
// block, is the type alias type name = typeof name.Type, the order in which a
// schema alias's declaration file lists the two (D501).
func aliasTypeAfter(file *ast.SourceFile, statement *ast.Node, name string) bool {
	if statement.Parent == nil || !statement.Parent.CanHaveStatements() {
		return false
	}
	statements := statement.Parent.Statements()
	for i, s := range statements {
		if s == statement {
			if i+1 == len(statements) || !ast.IsTypeAliasDeclaration(statements[i+1]) {
				return false
			}
			alias := statements[i+1]
			return alias.TypeParameters() == nil && alias.Name().Text() == name &&
				strings.Join(strings.Fields(expressionText(file, alias.Type())), "") == "typeof"+name+".Type"
		}
	}
	return false
}
