package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

type tupleLiteralCallback struct {
	position int
	literal  *ast.Node
}

// Preserve positions through fixed spreads, inspecting only immediately
// supplied array literals. Stored tuples keep their independent source scope.
func inlineTupleCallbacks(c *checker.Checker, call *ast.Node) []tupleLiteralCallback {
	var result []tupleLiteralCallback
	position := 0
	arguments := rethrowsCallArguments(call)
	for i, argument := range arguments {
		if argument == nil || !ast.IsSpreadElement(argument) {
			position++
			continue
		}
		types, fixed := fixedRethrowsSpreadTypes(c, argument)
		if !fixed && i == len(arguments)-1 {
			types, fixed = trailingOptionalRethrowsSpreadTypes(c, argument)
		}
		if !fixed {
			break
		}
		if nodes, ok := inlineSpreadValues(c, argument.Expression()); ok && len(nodes) == len(types) {
			for offset, node := range nodes {
				if node == nil {
					continue
				}
				node = ast.SkipParentheses(node)
				if ast.IsFunctionExpressionOrArrowFunction(node) {
					result = append(result, tupleLiteralCallback{position + offset, node})
				}
			}
		}
		position += len(types)
	}
	return result
}

func inlineSpreadValues(c *checker.Checker, node *ast.Node) ([]*ast.Node, bool) {
	for node != nil {
		if ast.IsParenthesizedExpression(node) || ast.IsAsExpression(node) || ast.IsTypeAssertion(node) || ast.IsNonNullExpression(node) {
			node = node.Expression()
			continue
		}
		break
	}
	if node == nil || !ast.IsArrayLiteralExpression(node) {
		return nil, false
	}
	var result []*ast.Node
	for _, element := range node.AsArrayLiteralExpression().Elements.Nodes {
		if !ast.IsSpreadElement(element) {
			result = append(result, element)
			continue
		}
		types, fixed := fixedRethrowsSpreadTypes(c, element)
		if !fixed {
			return nil, false
		}
		if inner, ok := inlineSpreadValues(c, element.Expression()); ok && len(inner) == len(types) {
			result = append(result, inner...)
		} else {
			result = append(result, make([]*ast.Node, len(types))...)
		}
	}
	return result, true
}

func inlineTupleCallbackInvocation(c *checker.Checker, fn *ast.Node) (*ast.Node, int, bool) {
	inSpread := false
	for node := fn.Parent; node != nil; node = node.Parent {
		if ast.IsSpreadElement(node) {
			inSpread = true
		}
		if ast.IsFunctionLike(node) {
			break
		}
		if ast.IsCallExpression(node) || ast.IsNewExpression(node) || ast.IsTaggedTemplateExpression(node) {
			if !inSpread {
				break
			}
			for _, argument := range inlineTupleCallbacks(c, node) {
				if argument.literal == fn {
					return node, argument.position, true
				}
			}
			break
		}
	}
	return nil, 0, false
}

func (a *analyzer) rethrownTupleLiteralCalls(call *ast.Node) []*checker.Type {
	var thrown []*checker.Type
	for _, argument := range inlineTupleCallbacks(a.checker, call) {
		if rethrowsRuntimeArgument(a.checker, call, argument.position) {
			thrown = append(thrown, a.rethrownTupleLiteralCall(argument.literal)...)
		}
	}
	return thrown
}

func (a *analyzer) rethrownTupleLiteralCall(literal *ast.Node) []*checker.Type {
	var thrown []*checker.Type
	// Ordinary async initialization rejects its Promise. Generator
	// initialization still runs at the call; only its body is deferred.
	flags := ast.GetFunctionFlags(literal)
	if flags&ast.FunctionFlagsAsync != 0 && flags&ast.FunctionFlagsGenerator == 0 || a.runsAsEffect(literal) {
		return nil
	}
	if signature := a.checker.GetSignatureFromDeclaration(literal); signature != nil && isEffectfulType(a.checker, a.checker.GetReturnTypeOfSignature(signature)) {
		return nil
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		// Use the same source owner as the admission check. Class bases,
		// enum initializers and transparent expressions execute here;
		// nested callable bodies and class fields keep their own owners.
		if (ast.IsCallExpression(n) || ast.IsNewExpression(n) || ast.IsTaggedTemplateExpression(n)) &&
			a.plainHomeOf(n) == literal && (flags&ast.FunctionFlagsGenerator == 0 || inParameterListOf(n, literal)) && !caughtWithinLiteral(n, literal) {
			thrown = append(thrown, a.knownThrows(n)...)
			thrown = append(thrown, a.rethrownThrows(n)...)
		}
		return n.ForEachChild(visit)
	}
	literal.ForEachChild(visit)
	return thrown
}
