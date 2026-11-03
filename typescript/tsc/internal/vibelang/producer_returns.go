package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// A producer's Stream has no return value (VIP-21): `return value` in a
// producer is EK2128, and a bare `return` ends the stream. Before VIP-21 the
// value was evaluated and dropped, so the fix keeps its evaluation: `return`
// alone for a value that runs no code, `{ value; return }` otherwise. The fix
// applies only to a function marked effect. A plain function* is a JavaScript
// generator (VIP-21), whose caller can read the value through next() or
// yield*, so rewriting its return would lose data with nothing to flag it.

// EK2128: `return value` in a producer. {0} is the value.
var EK2128 = message(2128, errorCategory, "A producer returns a Stream, which has no return value, so {0} would be dropped; write return alone to end the stream.")

func init() {
	registry[EK2128.Code] = EK2128
	fileChecks = append(fileChecks, checkProducerReturns)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK2128.Code}, GetCodeActions: producerReturnFixActions})
	tsFormFixCodes = append(tsFormFixCodes, EK2128.Code)
}

// producerReturns calls f with each `return value` of each producer in file and
// the producer it returns from, except a function* written for an API that takes
// a JavaScript generator, which is EK1002 (generators.go), and one given to a
// callee that does not resolve, where nothing yet says which it is.
func producerReturns(c *checker.Checker, file *ast.SourceFile, f func(producer, ret *ast.Node)) {
	generators := generatorArguments(c, file)
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isProducer(n) && !generators[n] {
			var inProducer func(child *ast.Node) bool
			inProducer = func(child *ast.Node) bool {
				if isFunctionBoundary(child) {
					return false
				}
				if child.Kind == ast.KindReturnStatement && child.Expression() != nil {
					f(n, child)
				}
				return child.ForEachChild(inProducer)
			}
			n.Body().ForEachChild(inProducer)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// generatorArguments returns the function* expressions and declarations of
// file that are passed where a JavaScript generator is expected, or to a callee
// that does not resolve: with effect not installed, Effect.gen is such a callee,
// and rewriting its generator's return as a producer's would lose the value.
func generatorArguments(c *checker.Checker, file *ast.SourceFile) map[*ast.Node]bool {
	found := map[*ast.Node]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			for _, arg := range node.Arguments() {
				if isGeneratorFunction(c, arg) && (expectsGenerator(c, arg) || c.GetTypeAtLocation(node.Expression()) == c.GetErrorType()) {
					found[arg] = true
					if decl := generatorDeclaration(c, arg); decl != nil {
						found[decl] = true
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

func checkProducerReturns(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	producerReturns(c, file, func(producer, ret *ast.Node) {
		d := report(c, ret.Expression(), EK2128, nodeText(file, ret.Expression()))
		if !isMarkedEffect(producer) {
			note(d, "A JavaScript caller can read a plain function*'s return value, so vibelang --fix leaves it; mark the function effect if it is a producer.")
			return
		}
		note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", producerReturnRewrite(c, file, ret))
	})
}

// producerReturnRewrite is the statement that ends the stream and keeps the
// dropped value's evaluation.
func producerReturnRewrite(c *checker.Checker, file *ast.SourceFile, ret *ast.Node) string {
	if stableValue(c, ret.Expression()) {
		return "return"
	}
	return "{ " + nodeText(file, ret.Expression()) + "; return }"
}

func producerReturnFixActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	var actions []*ls.CodeAction
	producerReturns(c, fix.SourceFile, func(producer, ret *ast.Node) {
		if isMarkedEffect(producer) && len(actions) == 0 && nodeStart(fix.SourceFile, ret.Expression()) == fix.Span.Pos() {
			end := ret.End()
			if text := fix.SourceFile.Text(); end > 0 && text[end-1] == ';' {
				end--
			}
			actions = append(actions, &ls.CodeAction{Description: "End the stream without a value", Changes: replaceRange(fix, nodeStart(fix.SourceFile, ret), end, producerReturnRewrite(c, fix.SourceFile, ret))})
		}
	})
	return actions, nil
}
