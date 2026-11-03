package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterDeclaredTypeHook(hoistedBindingType) }

// hoistedBindingType types a let the parser hoisted for a pattern binding or
// its subject/extractor capture
// (hoistVibeLangIs in internal/parser): the declaration has no initializer,
// and the pattern assigns it, `(name = value, true)`, inside the condition
// the binding belongs to. The declared type is the value's type at that
// assignment, where the pattern's earlier tests have narrowed the subject,
// widened as a let initializer is. A read after the assignment keeps the
// assigned type by control flow; a read the pattern may not have reached is
// TS2454, the temporal dead zone of chapter 004. A let the source wrote keeps
// TypeScript's control-flow tracked type. Other parser temporaries, such as a
// do completion reset to undefined before a branch, evolve by that flow too.
func hoistedBindingType(c *checker.Checker, declaration *ast.Node) *checker.Type {
	if declaration.Flags&ast.NodeFlagsVibeLangPatternHoist == 0 || declaration.Initializer() != nil || declaration.Name() == nil || !ast.IsIdentifier(declaration.Name()) {
		return nil
	}
	values := hoistedValues(declaration)
	if len(values) == 0 {
		return nil
	}
	// Chapter 004: "a name bound in every alternative gets the union of its types".
	types := make([]*checker.Type, 0, len(values))
	for _, value := range values {
		t := c.GetTypeAtLocation(value)
		if t == nil {
			return nil
		}
		types = append(types, c.GetWidenedLiteralType(t))
	}
	if len(types) == 1 {
		return types[0]
	}
	return c.GetUnionType(types)
}
