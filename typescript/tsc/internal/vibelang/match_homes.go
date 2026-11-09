package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() { checker.RegisterDeclaredTypeHook(hoistedBindingType) }

// hoistedBindingType types hoisted pattern cells and initialized conjunction
// bindings. A binding retains an actual refinement of its captured value;
// without a refinement, it keeps native let widening. Hoisted captures infer
// from the pattern assignments, preserving definite-assignment checks and TDZ.
func hoistedBindingType(c *checker.Checker, declaration *ast.Node) *checker.Type {
	if declaration.Flags&(ast.NodeFlagsVibeLangPatternHoist|ast.NodeFlagsVibeLangPatternBinding) == 0 || declaration.Name() == nil || !ast.IsIdentifier(declaration.Name()) {
		return nil
	}
	// A raw computed-key tuple evolves through its assignment. Its expression
	// hook preserves the exact tuple at reads; giving it a declared type here
	// makes a nested do completion spuriously appear unassigned.
	if parser.MatchKeyTypeSource(declaration) != nil {
		return nil
	}
	values := []*ast.Node{declaration.Initializer()}
	if values[0] == nil {
		values = hoistedValues(declaration)
	}
	if len(values) == 0 {
		return nil
	}
	// Chapter 004: "a name bound in every alternative gets the union of its types".
	types := make([]*checker.Type, 0, len(values))
	for _, value := range values {
		t := c.GetTypeOfExpression(value)
		if t == nil {
			return nil
		}
		refined := declaration.Flags&ast.NodeFlagsVibeLangPatternBinding != 0
		if refined {
			if source := capturedSubject(c, value); source != nil {
				before := c.GetTypeOfExpression(source)
				if before == nil {
					return nil
				}
				// A fresh singleton subject has not been narrowed merely by
				// entering a conjunction such as let n and if(n === 1).
				refined = !c.IsTypeAssignableTo(t, before) || !c.IsTypeAssignableTo(before, t)
				if !refined {
					// Recover freshness from the original expression rather than
					// the capture whose flow type regularized that literal.
					t = before
				}
			}
		}
		if refined {
			t = c.GetRegularTypeOfLiteralType(t)
		} else {
			t = c.GetWidenedLiteralType(t)
		}
		types = append(types, t)
	}
	if len(types) == 1 {
		return types[0]
	}
	return c.GetUnionType(types)
}
