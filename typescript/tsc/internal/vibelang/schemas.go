package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Schema keyword eligibility analysis retains EK2109 and its explicit
// Schema-constant guidance. Existing declaration lowering remains unchanged.

// EK1505: a member of a schema body that is not a field. {0} is the member.
var EK1505 = message(1505, errorCategory, "{0} is not a field: a schema body holds only fields, each written name: Type or name?: Type.")

func init() {
	registry[EK1505.Code] = EK1505
	fileChecks = append(fileChecks, checkSchemaDeclarations)
}

// schemaKeywordConstants names the Schema constant of each keyword type that
// VIP-15's mapping leaves out.
var schemaKeywordConstants = map[string]string{
	"unknown": "Schema.Unknown",
	"any":     "Schema.Any",
	"never":   "Schema.Never",
	"object":  "Schema.ObjectKeyword",
	"void":    "Schema.Void",
}

// Schema keyword eligibility analysis retains EK2109 and its explicit
// Schema-constant guidance. Existing declaration lowering remains unchanged.
func noteSchemaKeyword(d *ast.Diagnostic, text string) bool {
	constant, ok := schemaKeywordConstants[text]
	if ok {
		note(d, "{0} is not a primitive; name its schema instead: {1}.", text, constant)
	}
	return ok
}

// schemaTypeID names the property that every Effect 4 schema has.
const schemaTypeID = "~effect/Schema/Schema"

// isSchemaStruct reports whether node is the Schema.Struct call that the
// parser writes for a schema declaration, or for an object type in one.
func isSchemaStruct(node *ast.Node) bool {
	return node.Kind == ast.KindCallExpression && node.Flags&ast.NodeFlagsVibeLang != 0
}

// isUnsupportedSchema reports whether node is the Schema.Unknown that the
// parser writes for a field type with no schema form.
func isUnsupportedSchema(node *ast.Node) bool {
	return node.Kind == ast.KindPropertyAccessExpression && node.Flags&ast.NodeFlagsVibeLang != 0
}

// isNonFieldSchema reports whether node is the Schema.Never that the parser
// writes for a member of a schema body that is not a field.
func isNonFieldSchema(node *ast.Node) bool {
	return isUnsupportedSchema(node) && node.Name().Text() == "Never"
}

func checkSchemaDeclarations(c *checker.Checker, file *ast.SourceFile) {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if outer := enclosingSchemaCall(n); isSchemaStruct(n) && (outer == nil || !isSchemaStruct(outer)) {
			checkSchemaFields(c, file, n, n)
		}
		if isSchemaErrorFields(n) {
			checkSchemaErrorFields(c, file, n) // errors_check.go
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// enclosingSchemaCall returns the call whose arguments hold node through
// arrays, objects, and property assignments, or nil.
func enclosingSchemaCall(node *ast.Node) *ast.Node {
	for n := node.Parent; n != nil; n = n.Parent {
		switch n.Kind {
		case ast.KindCallExpression:
			return n
		case ast.KindArrayLiteralExpression, ast.KindObjectLiteralExpression, ast.KindPropertyAssignment:
		default:
			return nil
		}
	}
	return nil
}

// checkSchemaFields checks the field schemas of call, a Schema.Struct call
// of a schema declaration whose outermost struct is declaration.
func checkSchemaFields(c *checker.Checker, file *ast.SourceFile, call *ast.Node, declaration *ast.Node) {
	for _, property := range call.Arguments()[0].AsObjectLiteralExpression().Properties.Nodes {
		checkSchemaValue(c, file, property.Initializer(), declaration)
	}
}

// checkSchemaValue checks value, the schema the parser wrote for one field
// type or a part of one.
func checkSchemaValue(c *checker.Checker, file *ast.SourceFile, value *ast.Node, declaration *ast.Node) {
	if replacement := schemaGenericReplacement(c, value); replacement != nil {
		value = replacement
	}
	switch {
	case isNonFieldSchema(value):
		// A member of the body that is not a field (D247): a method, a
		// signature, an accessor or a property without a type.
		d := report(c, value, EK1505, memberText(file, value))
		note(d, "A schema body lists the decoded keys; a method belongs on a schema error, and a key set is a Record<K, V> field.")
	case isUnsupportedSchema(value):
		loc := core.NewTextRange(scanner.SkipTrivia(file.Text(), value.Pos()), value.End())
		d := reportAt(c, file, loc, EK2109, file.Text()[loc.Pos():loc.End()])
		if !noteSchemaKeyword(d, file.Text()[loc.Pos():loc.End()]) {
			note(d, "Declare the schema with Schema.Struct, which takes any schema, such as Schema.DateTimeUtc.")
		}
	case isSchemaStruct(value):
		checkSchemaFields(c, file, value, declaration)
	case value.Kind == ast.KindCallExpression && value.Flags&ast.NodeFlagsReparsed == 0 && value.Expression().Flags&ast.NodeFlagsReparsed != 0:
		// Schema.Array(T), Schema.Union([A, B]), and the other combinators the
		// parser writes; a literal argument needs no check.
		for _, argument := range value.Arguments() {
			if argument.Kind == ast.KindArrayLiteralExpression {
				for _, element := range argument.AsArrayLiteralExpression().Elements.Nodes {
					checkSchemaValue(c, file, element, declaration)
				}
			} else {
				checkSchemaValue(c, file, argument, declaration)
			}
		}
	case (ast.IsIdentifier(value) || ast.IsPropertyAccessExpression(value)) && value.Flags&ast.NodeFlagsReparsed == 0:
		// A schema declaration remains a schema when cyclic inference gives it
		// any. Leave its initialization diagnostics to TypeScript.
		if isDeclaredSchemaReference(c, value) {
			return
		}
		// EK1303 already rejects an error's type parameters; a field naming
		// one gets no second diagnostic (003 static rules: one per member).
		if namesRejectedErrorTypeParameter(value) {
			cover(c, value) // TypeScript's error that the parameter is not a value
			return
		}
		if !isSchemaValue(c, c.GetTypeAtLocation(value)) {
			d := report(c, value, EK2109.With("{0} is not a schema: a field's type names a schema declaration or a schema constant."), entityText(value))
			note(d, "Declare {0} with schema, or name a schema constant, such as const When = Schema.DateTimeUtc.", entityText(value))
			cover(c, declaration) // TypeScript's errors about the struct's argument
		}
	}
}

// isDeclaredSchemaReference recognizes schema declarations without relying on
// their inferred type, which may be any while resolving an initialization cycle.
func isDeclaredSchemaReference(c *checker.Checker, value *ast.Node) bool {
	symbol := c.GetSymbolAtLocation(value)
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		if declaration.Kind != ast.KindVariableDeclaration {
			continue
		}
		if isSchemaAlias(declaration) || declaration.Initializer() != nil && isSchemaStruct(declaration.Initializer()) {
			return true
		}
	}
	return false
}

// namesRejectedErrorTypeParameter reports whether value, a field schema the
// parser wrote from a field type, names a type parameter of the error
// declaration whose heritage holds it. checkErrorTypeParameters reports
// those parameters with EK1303.
func namesRejectedErrorTypeParameter(value *ast.Node) bool {
	if !ast.IsIdentifier(value) {
		return false
	}
	for n := value.Parent; n != nil; n = n.Parent {
		if !ast.IsClassDeclaration(n) {
			continue
		}
		if !errorDeclarationBase(n) {
			return false
		}
		parameters := n.ClassLikeData().TypeParameters
		if parameters == nil {
			return false
		}
		for _, parameter := range parameters.Nodes {
			if parameter.Name().Text() == value.Text() {
				return true
			}
		}
		return false
	}
	return false
}
