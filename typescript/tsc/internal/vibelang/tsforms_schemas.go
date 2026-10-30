package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK4832 (D286): a constant that holds a Schema.Struct, which a schema
// declaration (D133) writes with its type:
//
//	const User = Schema.Struct({ id: Schema.String, nickname: Schema.optional(Schema.String) })
//	schema User { id: string; nickname?: string }
//
// The parser writes a schema declaration's fields back into the same
// Schema.Struct call, so the rewrite is exact when every field maps back:
// Schema.String and the other keyword schemas, Schema.Null, Schema.Literal
// of a literal, Schema.Literals of two or more, Schema.Union of two or more
// members that are not all literals and not unions, Schema.Array,
// Schema.Tuple, Schema.Record, a nested Schema.Struct, Schema.optional and
// Schema.mutableKey around a field in the order the parser writes them, and a
// name or a dotted name of any other schema, which a field names as a value.
// The declaration also declares the interface User, the struct's Type, so
// the rewrite applies only when no other type of that name is in scope, or
// when the only one is the struct's own type written beside it, as
// type User = typeof User.Type, type User = Schema.Schema.Type<typeof User>,
// or an empty interface that extends the latter, which it replaces; a type
// alias becomes an interface. Anything else, a check, an annotation, a pipe,
// Schema.optionalKey, a spread, a computed key, a comment, or a declaration
// with a type annotation or more than one binding, keeps the constant and
// draws no warning: no schema declaration says the same. So does an exported
// constant with no type of its name in a project that emits declarations:
// the declaration would add the type to the declaration file, which the
// TypeScript did not export (D501). EK4841
// (fix_schema_alias.go, D474) writes a constant of another schema with D280's
// alias form, schema Name = type.

func init() {
	tsFormRules[EK4832.Code] = &tsFormRule{
		message: EK4832,
		find:    findSchemaConstants,
		plan: func(c *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite {
			return schemaConstantRewrite(c, file, at)
		},
		diagnosed: isSchemaConstantName,
	}
}

// isSchemaConstantName reports whether node is the name of a variable
// declaration.
func isSchemaConstantName(node *ast.Node) bool {
	return ast.IsIdentifier(node) && node.Parent != nil && ast.IsVariableDeclaration(node.Parent) && node.Parent.Name() == node
}

// schemaKeywordTypes maps each primitive schema of Schema to the type a
// schema declaration writes for it (VIP-15). Any other schema, Schema.Unknown
// included, keeps its name.
var schemaKeywordTypes = func() map[string]string {
	types := map[string]string{"Null": "null"}
	for kind, schema := range map[ast.Kind]string{
		ast.KindStringKeyword: "String", ast.KindNumberKeyword: "Number", ast.KindBooleanKeyword: "Boolean",
		ast.KindBigIntKeyword: "BigInt", ast.KindSymbolKeyword: "Symbol", ast.KindUndefinedKeyword: "Undefined",
	} {
		types[schema] = scanner.TokenToString(kind)
	}
	return types
}()

// findSchemaConstants reports EK4832 at each constant of file whose
// Schema.Struct a schema declaration writes.
func findSchemaConstants(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsVariableStatement(node) && !inHatch(node) {
			declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
			if len(declarations) == 1 && isSchemaConstantName(declarations[0].Name()) {
				if rewrite := schemaConstantRewrite(c, file, declarations[0].Name()); rewrite.fixable() {
					report(declarations[0].Name(), rewrite, declarations[0].Name().Text())
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// schemaConstantRewrite plans EK4832's fix for the constant name names.
func schemaConstantRewrite(c *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	declaration := name.Parent
	list := declaration.Parent
	statement := list.Parent
	if !ast.IsVariableStatement(statement) || list.Flags&ast.NodeFlagsConst == 0 || len(list.AsVariableDeclarationList().Declarations.Nodes) != 1 ||
		declaration.Type() != nil || declaration.AsVariableDeclaration().ExclamationToken != nil || declaration.Initializer() == nil || statement.Flags&ast.NodeFlagsVibeLang != 0 {
		return nil
	}
	for _, modifier := range statement.ModifierNodes() {
		if modifier.Kind != ast.KindExportKeyword {
			return nil
		}
	}
	call := declaration.Initializer()
	if !ast.IsCallExpression(call) || call.Flags&ast.NodeFlagsVibeLang != 0 || call.Expression().Flags&ast.NodeFlagsReparsed != 0 {
		return nil // a schema declaration already
	}
	text := file.Text()
	if body := text[nodeStart(file, call):call.End()]; strings.Contains(body, "//") || strings.Contains(body, "/*") {
		return nil
	}
	indent := lineIndent(text, nodeStart(file, statement))
	fields, ok := structFieldsType(c, file, call, indent)
	if !ok {
		return nil
	}
	exported := ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport)
	edits, ok := schemaTypeEdits(c, file, statement, name, exported)
	if !ok || exported && len(edits) == 0 && c.CompilerOptions().GetEmitDeclarations() {
		return nil
	}
	start := nodeStart(file, statement)
	if modifiers := statement.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
		start = scanner.SkipTrivia(text, modifiers.End())
	}
	end := statement.End()
	declarationText := "schema " + name.Text() + " " + fields
	edits = append([]sourceEdit{{start, end, declarationText}}, edits...)
	return withImportRemovals(c, file, &formRewrite{edits: edits, description: shortText(declarationText, "schema "+name.Text()+" { … }")})
}

// schemaTypeEdits returns the edits that remove the struct's own type written
// beside statement, and false when another type of name is in scope.
func schemaTypeEdits(c *checker.Checker, file *ast.SourceFile, statement *ast.Node, name *ast.Node, exported bool) ([]sourceEdit, bool) {
	symbol := c.ResolveName(name.Text(), statement, ast.SymbolFlagsType, false)
	if symbol == nil {
		return nil, true
	}
	var declarations []*ast.Node
	for _, d := range symbol.Declarations() {
		if !ast.IsVariableDeclaration(d) {
			declarations = append(declarations, d)
		}
	}
	if len(declarations) == 0 {
		return nil, true
	}
	if len(declarations) != 1 || declarations[0].Parent != statement.Parent || !isStructOwnType(file, declarations[0], name.Text()) ||
		ast.HasSyntacticModifier(declarations[0], ast.ModifierFlagsExport) != exported || len(declarations[0].JSDoc(file)) != 0 {
		return nil, false
	}
	text := file.Text()
	alias := declarations[0]
	start, end := nodeStart(file, alias), alias.End()
	// Remove the line the type stands on when nothing else does.
	lineStart := strings.LastIndexByte(text[:start], '\n') + 1
	newline := strings.IndexByte(text[end:], '\n')
	if strings.TrimSpace(text[lineStart:start]) == "" && newline >= 0 && strings.TrimSpace(text[end:end+newline]) == "" {
		start, end = lineStart, end+newline+1
	}
	return []sourceEdit{{start, end, ""}}, true
}

// isStructOwnType reports whether declaration is a struct's own type written
// beside it: type X = typeof X.Type, type X = Schema.Schema.Type<typeof X>,
// or interface X extends Schema.Schema.Type<typeof X> {}.
func isStructOwnType(file *ast.SourceFile, declaration *ast.Node, name string) bool {
	compact := func(node *ast.Node) string {
		return strings.Join(strings.Fields(expressionText(file, node)), "")
	}
	ownType := map[string]bool{"typeof" + name + ".Type": true, "Schema.Schema.Type<typeof" + name + ">": true}
	switch {
	case ast.IsTypeAliasDeclaration(declaration) && declaration.TypeParameters() == nil:
		return ownType[compact(declaration.Type())]
	case ast.IsInterfaceDeclaration(declaration) && declaration.TypeParameters() == nil && len(declaration.Members()) == 0:
		heritage := ast.GetExtendsHeritageClauseElements(declaration)
		return len(heritage) == 1 && ownType[compact(heritage[0])]
	}
	return false
}

// structFieldsType returns the fields of call, a Schema.Struct call, as a
// schema declaration's object type, and false when a field has no type that
// the parser would turn back into the same schema. indent is the indentation
// of the line the object type starts on.
func structFieldsType(c *checker.Checker, file *ast.SourceFile, call *ast.Node, indent string) (string, bool) {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || !isEffectFunction(c, call.Expression(), "Schema", "Struct") || len(call.Arguments()) != 1 || !ast.IsObjectLiteralExpression(call.Arguments()[0]) {
		return "", false
	}
	object := call.Arguments()[0]
	properties := object.AsObjectLiteralExpression().Properties.Nodes
	if len(properties) == 0 {
		return "{}", true
	}
	var fields []string
	for _, property := range properties {
		field, ok := structFieldType(c, file, property, indent+"  ")
		if !ok {
			return "", false
		}
		fields = append(fields, field)
	}
	if !strings.ContainsAny(file.Text()[nodeStart(file, object):object.End()], "\r\n") {
		return "{ " + strings.Join(fields, "; ") + " }", true
	}
	return "{\n" + indent + "  " + strings.Join(fields, "\n"+indent+"  ") + "\n" + indent + "}", true
}

// structFieldType returns property, a field of a Schema.Struct's object, as
// a member of an object type.
func structFieldType(c *checker.Checker, file *ast.SourceFile, property *ast.Node, indent string) (string, bool) {
	var key string
	var value *ast.Node
	switch {
	case ast.IsPropertyAssignment(property):
		name := property.Name()
		if !ast.IsIdentifier(name) && !ast.IsStringLiteral(name) && !ast.IsNumericLiteral(name) {
			return "", false
		}
		key, value = expressionText(file, name), property.Initializer()
	case ast.IsShorthandPropertyAssignment(property):
		if property.AsShorthandPropertyAssignment().ObjectAssignmentInitializer != nil {
			return "", false
		}
		key, value = property.Name().Text(), property.Name()
	default:
		return "", false
	}
	mutable, optional := false, false
	if isSchemaCall(c, value, "mutableKey", 1) {
		mutable, value = true, value.Arguments()[0]
	}
	if isSchemaCall(c, value, "optional", 1) {
		optional, value = true, value.Arguments()[0]
	}
	if !optional {
		if known, required := schemaStructValueRequired(c, value); known && !required {
			return "", false
		}
	}
	typeText, ok := schemaTypeText(c, file, value, indent)
	if !ok {
		return "", false
	}
	field := key
	if mutable {
		field = "mutable " + field
	}
	if optional {
		field += "?"
	}
	return field + ": " + typeText, true
}

// isSchemaCall reports whether node calls Schema's function name with count
// arguments and no type arguments.
func isSchemaCall(c *checker.Checker, node *ast.Node, name string, count int) bool {
	return ast.IsCallExpression(node) && node.TypeArguments() == nil && len(node.Arguments()) == count && isEffectFunction(c, node.Expression(), "Schema", name)
}

// schemaTypeText returns the type a schema declaration writes for schema, a
// field's schema, and false when there is none.
func schemaTypeText(c *checker.Checker, file *ast.SourceFile, schema *ast.Node, indent string) (string, bool) {
	switch {
	case ast.IsIdentifier(schema) || ast.IsPropertyAccessExpression(schema):
		if !ast.IsEntityNameExpression(schema) {
			return "", false
		}
		if module, name := effectMember(c, schema); module == "Schema" && ast.IsPropertyAccessExpression(schema) {
			if keyword, ok := schemaKeywordTypes[name]; ok {
				return keyword, true
			}
		}
		return expressionText(file, schema), true
	case !ast.IsCallExpression(schema) || schema.TypeArguments() != nil:
		return "", false
	}
	arguments := schema.Arguments()
	module, name := effectMember(c, schema.Expression())
	if module != "Schema" || !ast.IsPropertyAccessExpression(schema.Expression()) {
		return "", false
	}
	switch name {
	case "Literal":
		if len(arguments) != 1 || !isSchemaLiteralValue(arguments[0]) {
			return "", false
		}
		return expressionText(file, arguments[0]), true
	case "Literals":
		if len(arguments) != 1 || !ast.IsArrayLiteralExpression(arguments[0]) {
			return "", false
		}
		elements := arguments[0].Elements()
		if len(elements) < 2 {
			return "", false
		}
		var literals []string
		for _, element := range elements {
			if !isSchemaLiteralValue(element) {
				return "", false
			}
			literals = append(literals, expressionText(file, element))
		}
		return strings.Join(literals, " | "), true
	case "Union":
		if len(arguments) != 1 || !ast.IsArrayLiteralExpression(arguments[0]) {
			return "", false
		}
		elements := arguments[0].Elements()
		if len(elements) < 2 {
			return "", false
		}
		var members []string
		allLiterals := true
		for _, element := range elements {
			member, ok := schemaTypeText(c, file, element, indent)
			if !ok || hasTopLevel(member, "|") {
				return "", false
			}
			allLiterals = allLiterals && isSchemaCall(c, element, "Literal", 1)
			members = append(members, unionMemberText(member))
		}
		if allLiterals {
			return "", false // the parser would write Schema.Literals
		}
		return strings.Join(members, " | "), true
	case "mutable":
		if len(arguments) != 1 || !(isSchemaCall(c, arguments[0], "Array", 1) || isSchemaCall(c, arguments[0], "Tuple", 1)) {
			return "", false
		}
		inner, ok := schemaTypeText(c, file, arguments[0], indent)
		if !ok {
			return "", false
		}
		if strings.HasPrefix(inner, "ReadonlyArray<") {
			return "Array<" + strings.TrimPrefix(inner, "ReadonlyArray<"), true
		}
		return strings.TrimPrefix(inner, "readonly "), true
	case "Array":
		if len(arguments) != 1 {
			return "", false
		}
		element, ok := schemaTypeText(c, file, arguments[0], indent)
		if !ok {
			return "", false
		}
		return "ReadonlyArray<" + element + ">", true
	case "Tuple":
		if len(arguments) != 1 || !ast.IsArrayLiteralExpression(arguments[0]) {
			return "", false
		}
		var elements []string
		for _, element := range arguments[0].Elements() {
			text, ok := schemaTypeText(c, file, element, indent)
			if !ok || ast.IsSpreadElement(element) {
				return "", false
			}
			elements = append(elements, text)
		}
		return "readonly [" + strings.Join(elements, ", ") + "]", true
	case "Record":
		if len(arguments) != 2 {
			return "", false
		}
		key, ok := schemaTypeText(c, file, arguments[0], indent)
		if !ok {
			return "", false
		}
		valueSchema := arguments[1]
		mutable := isSchemaCall(c, valueSchema, "mutableKey", 1)
		if mutable {
			valueSchema = valueSchema.Arguments()[0]
		}
		value, ok := schemaTypeText(c, file, valueSchema, indent)
		if !ok {
			return "", false
		}
		result := "Record<" + key + ", " + value + ">"
		if !mutable {
			result = "Readonly<" + result + ">"
		}
		return result, true
	case "Struct":
		return structFieldsType(c, file, schema, indent)
	}
	return "", false
}

// unionMemberText parenthesizes text, a type, where it would not stay one
// member of a union or an array's element.
func unionMemberText(text string) string {
	if hasTopLevel(text, "|") || hasTopLevel(text, "=>") || hasTopLevel(text, "?") || hasTopLevel(text, "&") {
		return "(" + text + ")"
	}
	return text
}

// isSchemaLiteralValue reports whether node is a literal a literal type can
// write, other than null: a string, a number, a negative number, a bigint, or
// a boolean.
func isSchemaLiteralValue(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNoSubstitutionTemplateLiteral:
		return true
	case ast.KindPrefixUnaryExpression:
		unary := node.AsPrefixUnaryExpression()
		return unary.Operator == ast.KindMinusToken && (ast.IsNumericLiteral(unary.Operand) || unary.Operand.Kind == ast.KindBigIntLiteral)
	}
	return false
}
