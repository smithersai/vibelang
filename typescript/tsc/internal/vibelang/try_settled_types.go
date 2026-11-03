package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { checker.RegisterCallExpressionTypeHook(trySettledType) }

type trySettledTypeKey struct{}
type trySettledTypes struct{ calls map[*ast.Node]*checker.Type }

// VIP-18: a held operand is source.map(Effect.exit), not a homomorphic
// mapped tuple. Ask TypeScript to resolve that actual callback and Effect.all
// overload; deriving channels from A[number] skips the callback's inference.
func trySettledType(c *checker.Checker, call *ast.Node, fallback *checker.Type) *checker.Type {
	if tryOperationName(call) != "try.allSettled" {
		return fallback
	}
	operand := ast.SkipParentheses(call.Arguments()[0])
	if !tryOperationArrayType(c, c.GetTypeAtLocation(operand)) {
		return fallback
	}
	literal := ast.IsArrayLiteralExpression(operand)
	state := c.ExtensionState(trySettledTypeKey{}, func() any { return &trySettledTypes{calls: map[*ast.Node]*checker.Type{}} }).(*trySettledTypes)
	if t := state.calls[call]; t != nil {
		return t
	}
	f := &ast.NodeFactory{}
	at := func(node *ast.Node) *ast.Node { node.Loc = operand.Loc; node.Parent = call; return node }
	value := func(t *checker.Type) *ast.Node { return at(f.NewSyntheticExpression(t, false, nil)) }
	invoke := func(callee *ast.Node, args ...*ast.Node) *ast.Node {
		node := at(f.NewCallExpression(callee, nil, nil, f.NewNodeList(args), ast.NodeFlagsNone))
		callee.Parent = node
		for _, arg := range args {
			arg.Parent = node
		}
		return node
	}
	file := ast.GetSourceFileOfNode(call)
	member := func(name string) *ast.Node {
		symbol := effectExportSymbol(c, preludeStateOf(c), file, name)
		if symbol == nil {
			return nil
		}
		return value(c.GetTypeOfSymbol(symbol))
	}
	if member("exit") == nil || member("all") == nil {
		return fallback
	}
	mapped := func(t *checker.Type) *ast.Node {
		receiver := value(t)
		name := at(f.NewIdentifier("map"))
		access := at(f.NewPropertyAccessExpression(receiver, nil, name, ast.NodeFlagsNone))
		receiver.Parent, name.Parent = access, access
		// Each use has its own contextual instantiation, including separate spreads.
		return invoke(access, member("exit"))
	}
	var source *ast.Node
	if !literal {
		source = mapped(c.GetTypeAtLocation(operand))
	} else {
		var elements []*ast.Node
		for _, element := range operand.Elements() {
			var result *ast.Node
			if ast.IsSpreadElement(element) {
				// Source spreads use the iterable protocol and widen their tuple part.
				item := c.IteratedType(c.GetTypeAtLocation(element.Expression()))
				if item == nil {
					return fallback
				}
				result = at(f.NewSpreadElement(mapped(c.CreateArrayType(item, false))))
				result.Expression().Parent = result
			} else {
				result = invoke(member("exit"), value(c.GetTypeAtLocation(element)))
			}
			elements = append(elements, result)
		}
		source = at(f.NewArrayLiteralExpression(f.NewNodeList(elements), false))
		for _, element := range elements {
			element.Parent = source
		}
	}
	options := value(c.NewReadonlyPropertyType("concurrency", c.GetStringLiteralType("unbounded")))
	native := invoke(member("all"), source, options)
	t := c.CheckSyntheticExpression(native)
	state.calls[call] = t
	return t
}
