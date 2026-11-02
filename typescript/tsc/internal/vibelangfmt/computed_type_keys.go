package vibelangfmt

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"strconv"
	"strings"
)

// TypeScript's computed field and type-member key checks distinguish a bare
// identifier/property access from a parenthesized one. These groups are not
// redundant layout, even when the expression has the same value and type.
// A schema error's runtime field keys can also pass through a type/class
// projection; retaining their written groups is safe in every projection.
func computedFieldKey(node *ast.Node) *ast.Node {
	switch node.Kind {
	case ast.KindPropertyDeclaration, ast.KindPropertySignature, ast.KindMethodSignature:
		if name := node.Name(); name != nil && ast.IsComputedPropertyName(name) {
			return name.Expression()
		}
	}
	return nil
}

// Record grouping positions inside the whole key, not just at its root:
// (keys).value is also outside TypeScript's entity-name grammar.
func computedKeyGrouping(node *ast.Node) string {
	if node.Kind == ast.KindParenthesizedExpression {
		return "(" + computedKeyGrouping(node.Expression()) + ")"
	}
	var groups strings.Builder
	index := 0
	node.ForEachChild(func(child *ast.Node) bool {
		if shape := computedKeyGrouping(child); shape != "" {
			groups.WriteString(strconv.Itoa(index))
			groups.WriteByte(':')
			groups.WriteString(shape)
			groups.WriteByte(';')
		}
		index++
		return false
	})
	return groups.String()
}

func (e *encoder) protectComputedFieldKeys() {
	seen := map[core.TextRange]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		key := computedFieldKey(node)
		// Schema field names may already be projected into runtime object
		// properties. Keep their groups before a formatter's type projection
		// can give them the stricter native type-member interpretation.
		parent := node.Parent
		schemaField := parent != nil && ast.IsObjectLiteralExpression(parent) &&
			(parent.Flags&ast.NodeFlagsVibeLang != 0 || parent.Parent != nil &&
				ast.IsCallExpression(parent.Parent) && parent.Parent.Flags&ast.NodeFlagsVibeLang != 0)
		if key == nil && ast.IsPropertyAssignment(node) && schemaField {
			if name := node.Name(); name != nil && ast.IsComputedPropertyName(name) {
				key = name.Expression()
			}
		}
		if key != nil && computedKeyGrouping(key) != "" && !seen[key.Loc] {
			seen[key.Loc] = true
			e.opaque(placeholderText, key.Loc, "", "", firstLineWidth(e.text(key.Loc)))
		}
		return node.ForEachChild(visit)
	}
	e.file.AsNode().ForEachChild(visit)
	for _, module := range e.file.EmbeddedModules() {
		module.AsNode().ForEachChild(visit)
	}
}
