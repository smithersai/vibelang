package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Both sides of a catch expression are typed from the expression's own
// contextual type, as TypeScript types both branches of a conditional
// expression (D293). The parser passes each side to $catchExpression as a
// function, whose parameter types are generic Effects, so without this the
// sides would see only $catchExpression's type parameters and a literal such
// as _tag: "Found" would widen to string before it reached the declared type:
//
//	function select(n: number): Outcome!! {
//	  return { _tag: "Found", value: find(n) } catch (error) => ({ _tag: "Error", error })
//	}

func init() {
	checker.RegisterContextualReturnTypeHook(catchOperandReturnType)
}

// catchOperandReturnType gives what fn returns the contextual type of the
// catch expression that fn is a side of: the parser's function around its
// left side or its fallback, or a handler the source wrote. When the catch
// expression has no contextual type, or fn is not a side of one, t stands.
// The expression's contextual type is a value where the expression runs (D24)
// and a program where it is held (D147, D269); what fn returns is the value,
// the program's success type.
func catchOperandReturnType(c *checker.Checker, fn *ast.Node, t *checker.Type, _ func() *checker.Type) *checker.Type {
	if fn == nil || !ast.IsFunctionExpressionOrArrowFunction(fn) {
		return t
	}
	call := catchExpressionOf(fn.Parent)
	if call == nil || !isLowerable(fn) {
		return t
	}
	if inlineCatchLeft(fn) {
		return t // the head produces an Effect, not the catch success value
	}
	contextual := c.GetContextualType(call, checker.ContextFlagsNone)
	if contextual == nil {
		return t
	}
	if success := successType(c, contextual); success != nil {
		return success
	}
	return contextual
}
