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
	checker.RegisterCallExpressionReplacementHook(schemaGenericCallReplacement)
	checker.RegisterExpressionTypeHook(schemaLibraryNameType)
	fileChecks = append(fileChecks, checkSchemaGenericReferences)
}

// The library kinds a schema reference can select (VIP-44).
const (
	schemaLibrarySet   = 5
	schemaLibraryMap   = 6
	schemaLibraryValue = 7
)

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
	if ref.Arity == 0 {
		if ref.Library != nil && ast.IsIdentifier(ref.Name) && symbol.Name() == ref.Name.Text() {
			return schemaLibraryValue
		}
		return 0
	}
	if ref.InnerName != nil && symbol.Name() == "Readonly" {
		// Elsewhere the inner name's own reference selects Record or ReadonlyMap.
		if inner := c.ResolveEntityName(ref.InnerName, ast.SymbolFlagsType); isGlobal(c, inner) && inner.Name() == "Record" {
			return 4
		}
		return 0
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
	case "ReadonlySet":
		if ref.Arity == 1 && ref.Library != nil {
			return schemaLibrarySet
		}
	case "ReadonlyMap":
		if ref.Arity == 2 && ref.Library != nil {
			return schemaLibraryMap
		}
	}
	return 0
}

func schemaGenericReplacement(c *checker.Checker, node *ast.Node) *ast.Node {
	if ast.IsIdentifier(node) {
		return schemaLibraryNameReplacement(c, node)
	}
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
		case schemaLibrarySet:
			selected = ref.Library
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
	case schemaLibrarySet, schemaLibraryMap:
		return ref.Library
	}
	return nil
}

// schemaLibraryNameReplacement returns Schema.Date for a schema field's Date
// whose type binding is the TypeScript library's, and nil for any other name.
// Only a field codec's own position can hold one, so other names return fast.
func schemaLibraryNameReplacement(c *checker.Checker, node *ast.Node) *ast.Node {
	parent := node.Parent
	if parent == nil || !(ast.IsPropertyAssignment(parent) || ast.IsCallExpression(parent) || ast.IsArrayLiteralExpression(parent) || ast.IsVariableDeclaration(parent)) {
		return nil
	}
	file := ast.GetSourceFileOfNode(node)
	if file == nil || len(file.VibeLangSchemaGenerics) == 0 {
		return nil
	}
	ref := schemaGenericReferences(c, file)[node]
	if ref == nil || ref.Arity != 0 || schemaGenericKind(c, ref) != schemaLibraryValue {
		return nil
	}
	return ref.Library
}

// schemaLibraryNameType gives a selected library name its Schema's type, as
// schemaGenericCallType does for a generic call's replacement.
func schemaLibraryNameType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if !ast.IsIdentifier(node) {
		return t
	}
	if replacement := schemaLibraryNameReplacement(c, node); replacement != nil {
		return c.GetTypeAtLocation(replacement)
	}
	return t
}

// schemaGenericCallReplacement has the checker check the selected codec's call
// in place of the visible one, so the shared arguments meet the selected
// signature: Schema.ReadonlyMap takes any key schema, where the visible
// Schema.Record candidate would report TS2345 for a Date, collection, tuple
// or struct key. The emitter selects the same call (plan.go).
func schemaGenericCallReplacement(c *checker.Checker, node *ast.Node) *ast.Node {
	if !ast.IsCallExpression(node) {
		return nil
	}
	if replacement := schemaGenericReplacement(c, node); replacement != nil && ast.IsCallExpression(replacement) {
		return replacement
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
		if ref.Arity == 0 {
			continue // the written name's ordinary Schema-value check applies
		}
		if ast.GetSourceFileOfNode(ref.Name) == file && schemaGenericKind(c, ref) == 0 {
			// An outer reference reports its own name. The inner name has its
			// own reference, which reports an unmapped inner type; only
			// Readonly<ReadonlyMap<K, V>> is reported here, at the inner name.
			name, readonlyMap := ref.Name, false
			if ref.InnerName != nil {
				if outer := c.ResolveEntityName(ref.Name, ast.SymbolFlagsType); isGlobal(c, outer) && outer.Name() == "Readonly" {
					inner := c.ResolveEntityName(ref.InnerName, ast.SymbolFlagsType)
					if !isGlobal(c, inner) || inner.Name() != "ReadonlyMap" {
						continue
					}
					name, readonlyMap = ref.InnerName, true
				}
			}
			span := core.NewTextRange(scanner.SkipTrivia(file.Text(), name.Pos()), name.End())
			d := reportAt(c, file, span, EK2109.With("This generic type does not name a mapped TypeScript-library schema type."))
			if readonlyMap {
				note(d, "Readonly<T> maps only a Record. A ReadonlyMap is already read-only: write ReadonlyMap<K, V>, which maps to Schema.ReadonlyMap.")
			} else if mutable := schemaMutableCollection(c, ref); mutable != "" {
				note(d, "Effect has no mutable "+mutable+" schema. Write Readonly"+mutable+", which maps to Schema.Readonly"+mutable+".")
			}
			note(d, "Name a schema value without type arguments, or write the decoder with explicit Effect Schema codecs.")
		}
	}
}

// schemaMutableCollection returns "Set" or "Map" when ref names the library's
// mutable collection, which VIP-44 leaves without a schema.
func schemaMutableCollection(c *checker.Checker, ref *ast.SchemaGenericReference) string {
	symbol := c.ResolveEntityName(ref.Name, ast.SymbolFlagsType)
	if !isGlobal(c, symbol) {
		return ""
	}
	switch {
	case symbol.Name() == "Set" && ref.Arity == 1:
		return "Set"
	case symbol.Name() == "Map" && ref.Arity == 2:
		return "Map"
	}
	return ""
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
