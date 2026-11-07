package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangprotocol"
)

// nativeProducerCall keeps Stream callback fibers in the project's Effect
// instance. The private queue binding preserves the existing yield helpers.
func (tx *lowering) nativeProducerCall(body *ast.Node) *ast.Node {
	f := tx.Factory()
	bodyName := tx.fileName("producerBody")
	queue := tx.fileName("producerQueue")
	invoke := func(module *ast.Node, name string, args ...*ast.Node) *ast.Node {
		callee := f.NewPropertyAccessExpression(module, nil, f.NewIdentifier(name), ast.NodeFlagsNone)
		return f.NewCallExpression(callee, nil, nil, f.NewNodeList(args), ast.NodeFlagsNone)
	}
	effect := tx.effectName()
	key := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil, f.NewIdentifier("key"), nil, nil, f.NewStringLiteral(vibelangprotocol.ProducerQueueKey, ast.TokenFlagsNone)),
	}), false)
	run := invoke(effect, "provideService", invoke(effect, "suspend", bodyName), key, queue)
	complete := invoke(effect, "andThen", run, invoke(tx.moduleNamespace("effect/Queue"), "end", queue))
	callback := f.NewArrowFunction(nil, nil, f.NewNodeList([]*ast.Node{
		f.NewParameterDeclaration(nil, nil, queue, nil, nil, nil),
	}), nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), complete)
	options := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil, f.NewIdentifier("bufferSize"), nil, nil, f.NewNumericLiteral("1", ast.TokenFlagsNone)),
		f.NewPropertyAssignment(nil, f.NewIdentifier("strategy"), nil, nil, f.NewStringLiteral("suspend", ast.TokenFlagsNone)),
	}), false)
	stream := invoke(tx.moduleNamespace("effect/Stream"), "callback", callback, options)
	// Evaluate the body factory where the old helper argument stood, so
	// receiver binding and function construction stay at the producer call.
	bind := f.NewArrowFunction(nil, nil, f.NewNodeList([]*ast.Node{
		f.NewParameterDeclaration(nil, nil, bodyName, nil, nil, nil),
	}), nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), stream)
	return f.NewCallExpression(f.NewParenthesizedExpression(bind), nil, nil, f.NewNodeList([]*ast.Node{body}), ast.NodeFlagsNone)
}
