package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Schema aliases (D280).
//
//	schema Code = "root_missing" | "read_failed"
//
// declares the constant Code = Schema.Literals([...]) and the type alias
// Code = typeof Code.Type (internal/parser/vibelang_schema_alias.go). This
// file reports EK2109 at a part of the type with no schema form and at a name
// that is not a schema, as schemas.go does for a struct's fields. A struct
// inside the type, an object type, is checked by schemas.go's walk, which
// finds every outermost Schema.Struct call.

func init() { fileChecks = append(fileChecks, checkSchemaAliases) }

// ek2109Alias is EK2109 for the type of a schema alias.
var ek2109Alias = EK2109.With("{0} has no schema form: a schema's type is a primitive (string, number, boolean, bigint, symbol, undefined or null), a literal, a union, an array, a tuple, a Record, an object type, or another schema's name.")

func checkSchemaAliases(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isSchemaAlias(node) && node.Initializer() != nil {
			checkSchemaAliasValue(c, file, node.Initializer(), node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isSchemaAlias reports whether node is the variable declaration the parser
// writes for a schema alias, which it flags NodeFlagsVibeLang.
func isSchemaAlias(node *ast.Node) bool {
	return node.Kind == ast.KindVariableDeclaration && node.Flags&ast.NodeFlagsVibeLang != 0
}

// checkSchemaAliasValue checks value, the schema the parser wrote for an
// alias's type or a part of it, without descending into a struct.
func checkSchemaAliasValue(c *checker.Checker, file *ast.SourceFile, value *ast.Node, declaration *ast.Node) {
	switch {
	case isUnsupportedSchema(value):
		loc := core.NewTextRange(scanner.SkipTrivia(file.Text(), value.Pos()), value.End())
		d := reportAt(c, file, loc, ek2109Alias, file.Text()[loc.Pos():loc.End()])
		if !noteSchemaKeyword(d, file.Text()[loc.Pos():loc.End()]) {
			note(d, "Declare the schema with a Schema constant, such as const When = Schema.DateTimeUtc.")
		}
	case isSchemaStruct(value):
		// schemas.go checks the struct's fields.
	case value.Kind == ast.KindCallExpression && value.Flags&ast.NodeFlagsReparsed == 0 && value.Expression().Flags&ast.NodeFlagsReparsed != 0:
		for _, argument := range value.Arguments() {
			if argument.Kind == ast.KindArrayLiteralExpression {
				for _, element := range argument.AsArrayLiteralExpression().Elements.Nodes {
					checkSchemaAliasValue(c, file, element, declaration)
				}
			} else {
				checkSchemaAliasValue(c, file, argument, declaration)
			}
		}
	case (ast.IsIdentifier(value) || ast.IsPropertyAccessExpression(value)) && value.Flags&ast.NodeFlagsReparsed == 0:
		if isDeclaredSchemaReference(c, value) {
			return
		}
		if !isSchemaValue(c, c.GetTypeAtLocation(value)) {
			d := report(c, value, EK2109.With("{0} is not a schema: a schema's type names a schema declaration or a schema constant."), entityText(value))
			note(d, "Declare {0} with schema, or name a schema constant, such as const When = Schema.DateTimeUtc.", entityText(value))
			cover(c, declaration) // TypeScript's error about typeof Name.Type
		}
	}
}

// legacyNestedAliasFallback identifies a placeholder that earlier alias
// checking skipped. Struct fields were already checked and are not legacy
// aliases; keep their existing keyword suggestions.
func legacyNestedAliasFallback(file *ast.SourceFile, value *ast.Node) bool {
	if !isUnsupportedSchema(value) {
		return false
	}
	for node := value.Parent; node != nil; node = node.Parent {
		if isSchemaStruct(node) {
			return false
		}
		if isSchemaAlias(node) {
			parent := node.Parent
			if parent != nil && parent.Kind == ast.KindVariableDeclarationList {
				parent = parent.Parent
			}
			if parent != nil && parent.Kind == ast.KindVariableStatement {
				parent = parent.Parent
			}
			return parent != nil && parent != file.AsNode()
		}
	}
	return false
}

func legacyNestedAliasKeywordAt(file *ast.SourceFile, start, end int) bool {
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isUnsupportedSchema(node) && scanner.SkipTrivia(file.Text(), node.Pos()) == start && node.End() == end {
			found = legacyNestedAliasFallback(file, node)
			return found
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}
