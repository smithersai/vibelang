package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Schema declarations (D133).
//
//	schema User { id: string; role: "admin" | "member"; home: Address }
//
// declares the constant `User = Schema.Struct({ ... })` and the interface
// `User`, the struct's decoded type (internal/parser/vibelang.go). The checker
// reads both as written. This file reports EK2109 at a field whose type has
// no schema form, which the parser wrote as Schema.Unknown flagged
// NodeFlagsVibeLang, and at a field whose type names a value that is not a
// schema, such as Date.
//
// VIP-15 maps only primitives among the keyword types. unknown, any, never,
// object and void have no schema form; their quick fix, which vibelang --fix
// applies, writes the Schema constant the field meant, which the struct
// refers to by name:
//
//	schema Event { payload: unknown }
//	schema Event { payload: Schema.Unknown }

func init() {
	fileChecks = append(fileChecks, checkSchemaDeclarations)
	tsFormFixCodes = append(tsFormFixCodes, EK2109.Code)
	ls.RegisterCodeFixProvider(schemaKeywordFix)
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

// noteSchemaKeyword adds to d, EK2109 at text, the Schema constant that the
// quick fix writes, when text is a keyword type the mapping leaves out, and
// reports whether it did.
func noteSchemaKeyword(d *ast.Diagnostic, text string) bool {
	constant, ok := schemaKeywordConstants[text]
	if ok {
		note(d, "{0} is not a primitive; name its schema instead: {1}.", text, constant)
	}
	return ok
}

// schemaKeywordFix is EK2109's quick fix at a keyword type that the mapping
// leaves out: it writes the keyword's Schema constant.
var schemaKeywordFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		text := fix.SourceFile.Text()
		if fix.Diagnostic == nil || fix.Span.End() > len(text) {
			return nil, nil
		}
		constant, ok := schemaKeywordConstants[text[fix.Span.Pos():fix.Span.End()]]
		if !ok {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Write " + constant,
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: constant}},
		}}, nil
	},
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
	switch {
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
		if t := c.GetTypeAtLocation(value); t == nil || c.GetPropertyOfType(c.GetApparentType(t), schemaTypeID) == nil {
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
