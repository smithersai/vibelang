package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterDeclaredTypeHook(hoistedBindingType) }

// hoistedBindingType types a let the parser hoisted for an is binding home
// (hoistVibeLangIs in internal/parser): the declaration has no initializer,
// and the pattern assigns it, `(name = value, true)`, inside the condition
// the binding belongs to. The declared type is the value's type at that
// assignment, where the pattern's earlier tests have narrowed the subject,
// widened as a let initializer is. A read after the assignment keeps the
// assigned type by control flow; a read the pattern may not have reached is
// TS2454, the temporal dead zone of chapter 004. A let the source wrote keeps
// TypeScript's control-flow tracked type: its assignments are not reparsed.
func hoistedBindingType(c *checker.Checker, declaration *ast.Node) *checker.Type {
	if declaration.Initializer() != nil || declaration.Name() == nil || !ast.IsIdentifier(declaration.Name()) {
		return nil
	}
	value := hoistedValue(declaration)
	if value == nil {
		return nil
	}
	t := c.GetTypeAtLocation(value)
	if t == nil {
		return nil
	}
	return c.GetWidenedLiteralType(t)
}
