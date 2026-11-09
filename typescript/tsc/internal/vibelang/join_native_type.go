package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

type nativeJoinSymbolKey struct{}
type nativeJoinBinding struct{ symbol *ast.Symbol }

// The pinned native declaration supplies generic inference, including the
// unknown defaults for unconstrained and unreachable arguments.
func nativeJoinSymbol(c *checker.Checker) *ast.Symbol {
	return c.ExtensionState(nativeJoinSymbolKey{}, func() any {
		binding := &nativeJoinBinding{}
		for _, file := range c.Program().SourceFiles() {
			if isEffectModuleFile(c, file, "Fiber") && file.Symbol != nil {
				binding.symbol = c.TryGetMemberInModuleExports("join", file.Symbol)
				if binding.symbol != nil {
					break
				}
			}
		}
		return binding
	}).(*nativeJoinBinding).symbol
}

type nativeJoinTypeKey struct{}

func init() {
	checker.RegisterCallExpressionTypeHook(nativeJoinType)
}

// TypeScript's signature supplies the channels of unchecked and unreachable
// inputs. Resolve a typed synthetic call so operand checking remains with
// EK1704 and authored expressions retain their own diagnostics.
func nativeJoinType(c *checker.Checker, call *ast.Node, fallback *checker.Type) *checker.Type {
	if fiberHelper(call) != "$join" || len(call.Arguments()) != 1 {
		return fallback
	}
	operand := c.GetTypeAtLocation(call.Arguments()[0])
	if operand == nil {
		return fallback
	}
	unchecked := operand.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0
	if !unchecked && operand.Flags()&checker.TypeFlagsTypeParameter != 0 {
		constraint := c.GetBaseConstraintOfType(operand)
		unchecked = constraint != nil && constraint.Flags()&checker.TypeFlagsNever != 0
	}
	if !unchecked {
		return fallback
	}
	symbol := nativeJoinSymbol(c)
	if symbol == nil {
		return fallback
	}
	calls := c.ExtensionState(nativeJoinTypeKey{}, func() any {
		return map[*ast.Node]*checker.Type{}
	}).(map[*ast.Node]*checker.Type)
	if result := calls[call]; result != nil {
		return result
	}
	calls[call] = fallback
	f := &ast.NodeFactory{}
	callee := f.NewSyntheticExpression(c.GetTypeOfSymbol(symbol), false, nil)
	argument := f.NewSyntheticExpression(operand, false, nil)
	native := f.NewCallExpression(callee, nil, nil, f.NewNodeList([]*ast.Node{argument}), ast.NodeFlagsNone)
	native.Loc, native.Parent = call.Loc, call
	callee.Loc, callee.Parent = call.Expression().Loc, native
	argument.Loc, argument.Parent = call.Arguments()[0].Loc, native
	result := c.CheckSyntheticExpression(native)
	calls[call] = result
	return result
}
