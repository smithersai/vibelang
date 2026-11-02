package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

type schemaGenericStateKey struct{}
type schemaGenericState struct {
	files map[*ast.SourceFile]map[*ast.Node]*ast.SchemaGenericReference
}

func init() {
	checker.RegisterCallExpressionTypeHook(schemaGenericCallType)
	fileChecks = append(fileChecks, checkSchemaGenericReferences)
}

func schemaGenericReferences(c *checker.Checker, file *ast.SourceFile) map[*ast.Node]*ast.SchemaGenericReference {
	state := c.ExtensionState(schemaGenericStateKey{}, func() any {
		return &schemaGenericState{files: map[*ast.SourceFile]map[*ast.Node]*ast.SchemaGenericReference{}}
	}).(*schemaGenericState)
	if refs, ok := state.files[file]; ok {
		return refs
	}
	refs := map[*ast.Node]*ast.SchemaGenericReference{}
	for i := range file.VibeLangSchemaGenerics {
		ref := &file.VibeLangSchemaGenerics[i]
		// A tuple rest validates its source binding without replacing the
		// repeated codec or hiding a nested generic's replacement.
		if !ref.RestArray {
			refs[ref.Expression] = ref
		}
	}
	state.files[file] = refs
	return refs
}

// The source name is detached metadata anchored to its visible codec. Resolve
// only its type meaning; value-only bindings do not replace a library type.
func schemaGenericKind(c *checker.Checker, ref *ast.SchemaGenericReference) int {
	symbol := c.ResolveEntityName(ref.Name, ast.SymbolFlagsType)
	if !isGlobal(c, symbol) {
		return 0
	}
	if ref.InnerName != nil {
		inner := c.ResolveEntityName(ref.InnerName, ast.SymbolFlagsType)
		if !isGlobal(c, inner) || inner.Name() != "Record" {
			return 0
		}
		if symbol.Name() == "Readonly" {
			return 4
		}
	}
	switch symbol.Name() {
	case "Array":
		if ref.Arity == 1 {
			return 1
		}
	case "ReadonlyArray":
		if ref.Arity == 1 {
			return 2
		}
	case "Record":
		if ref.Arity == 2 {
			return 3
		}
	}
	return 0
}

func schemaGenericReplacement(c *checker.Checker, node *ast.Node) *ast.Node {
	if !ast.IsCallExpression(node) || node.Expression().Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	file := ast.GetSourceFileOfNode(node)
	if file == nil || len(file.VibeLangSchemaGenerics) == 0 {
		return nil
	}
	ref := schemaGenericReferences(c, file)[node]
	if ref == nil {
		return nil
	}
	if ref.ReadonlyRecord != nil {
		var selected *ast.Node
		switch schemaGenericKind(c, ref) {
		case 1:
			selected = ref.MutableArray
		case 2:
			selected = ref.ReadonlyArray
		case 4:
			selected = ref.ReadonlyRecord
		}
		if selected != node {
			return selected
		}
		return nil
	}
	switch schemaGenericKind(c, ref) {
	case 1:
		if !ref.DefaultMutable {
			return ref.MutableArray
		}
	case 2:
		if ref.DefaultMutable {
			return ref.ReadonlyArray
		}
	}
	return nil
}

func schemaGenericCallType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if replacement := schemaGenericReplacement(c, node); replacement != nil {
		return c.GetTypeAtLocation(replacement)
	}
	return t
}

func checkSchemaGenericReferences(c *checker.Checker, file *ast.SourceFile) {
	if len(file.VibeLangSchemaGenerics) == 0 {
		return
	}
	for i := range file.VibeLangSchemaGenerics {
		ref := &file.VibeLangSchemaGenerics[i]
		if ast.GetSourceFileOfNode(ref.Name) == file && schemaGenericKind(c, ref) == 0 {
			names := []*ast.Node{ref.Name}
			if ref.InnerName != nil {
				names = nil
				outer := c.ResolveEntityName(ref.Name, ast.SymbolFlagsType)
				if !isGlobal(c, outer) || (outer.Name() != "Array" && outer.Name() != "ReadonlyArray" && outer.Name() != "Readonly") {
					names = append(names, ref.Name)
				}
				inner := c.ResolveEntityName(ref.InnerName, ast.SymbolFlagsType)
				if !isGlobal(c, inner) || inner.Name() != "Record" {
					names = append(names, ref.InnerName)
				}
			}
			for _, name := range names {
				span := core.NewTextRange(scanner.SkipTrivia(file.Text(), name.Pos()), name.End())
				d := reportAt(c, file, span, EK2109.With("This generic type does not name a mapped TypeScript-library schema type."))
				note(d, "Name a schema value without type arguments, or write the decoder with explicit Effect Schema codecs.")
			}
		}
	}
}

// A normalizer writes canonical names. Their source bindings must denote the
// same library type as the codec being replaced, including through imports.
func schemaLibraryTypeName(c *checker.Checker, at *ast.Node, name string) bool {
	symbol := c.ResolveName(name, at, ast.SymbolFlagsType, false)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	return isGlobal(c, symbol) && symbol.Name() == name
}
