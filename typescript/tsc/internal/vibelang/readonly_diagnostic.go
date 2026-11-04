package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { checker.RegisterDiagnosticsFilterHook(explainDefaultReadonly) }

// Keep TS2540 and its location. Only a field of a data variant, an error or a
// schema error carries the parser's implicit readonly modifier: a property
// signature of the payload type, or a property declaration of the schema
// error's class. Chapters 3 and 6 make every such field readonly, as Effect's
// Data.TaggedEnum, Data.TaggedError and Schema.TaggedError do, so the note
// offers a new value, not a modifier (mutable is retired: EK2125 in a data
// variant, EK3410 in a plain error).
func explainDefaultReadonly(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	for i, d := range all {
		if d.Source() != "" || d.Code() != 2540 {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil {
			continue
		}
		symbol := c.GetSymbolAtLocation(name)
		if symbol == nil {
			continue
		}
		for _, declaration := range symbol.Declarations() {
			if !isVibeLangFile(ast.GetSourceFileOfNode(declaration)) || !isImplicitlyReadonlyField(declaration) {
				continue
			}
			all[i] = note(d.Clone(), "Every field of a data variant, an error or a schema error is readonly, as in Effect's Data.TaggedEnum, Data.TaggedError and Schema.TaggedError; construct a new value with the changed {0} instead.",
				scanner.GetTextOfNode(declaration.Name()))
			break
		}
	}
	return all
}

// isImplicitlyReadonlyField reports whether declaration is a field the parser
// made readonly: a data variant's or error's payload property, which carries
// a reparsed readonly modifier, or a schema error's field schema, a property
// of the fields object Schema.TaggedError receives.
func isImplicitlyReadonlyField(declaration *ast.Node) bool {
	switch declaration.Kind {
	case ast.KindPropertySignature, ast.KindPropertyDeclaration:
		if declaration.Modifiers() == nil {
			return false
		}
		for _, modifier := range declaration.Modifiers().Nodes {
			if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
				return true
			}
		}
	case ast.KindPropertyAssignment:
		return declaration.Parent != nil && isSchemaErrorFields(declaration.Parent)
	}
	return false
}
