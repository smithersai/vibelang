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
// alone for a value that runs no code, `{ value; return }` otherwise.

// EK2128: `return value` in a producer. {0} is the value.
var EK2128 = message(2128, errorCategory, "A producer returns a Stream, which has no return value, so {0} would be dropped; write return alone to end the stream.")

func init() {
	registry[EK2128.Code] = EK2128
	fileChecks = append(fileChecks, checkProducerReturns)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK2128.Code}, GetCodeActions: producerReturnFixActions})
	tsFormFixCodes = append(tsFormFixCodes, EK2128.Code)
}

// producerReturns calls f with each `return value` of each producer in file,
// except a function* written for an API that takes a JavaScript generator,
// which is EK1002 (generators.go).
func producerReturns(c *checker.Checker, file *ast.SourceFile, f func(ret *ast.Node)) {
	generators := generatorArguments(c, file)
	var inProducer func(n *ast.Node) bool
	inProducer = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindReturnStatement && n.Expression() != nil {
			f(n)
		}
		return n.ForEachChild(inProducer)
	}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isProducer(n) && !generators[n] {
			n.Body().ForEachChild(inProducer)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// generatorArguments returns the function* expressions and declarations of
// file that are passed where a JavaScript generator is expected.
func generatorArguments(c *checker.Checker, file *ast.SourceFile) map[*ast.Node]bool {
	found := map[*ast.Node]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			for _, arg := range node.Arguments() {
				if isGeneratorFunction(c, arg) && expectsGenerator(c, arg) {
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
	producerReturns(c, file, func(ret *ast.Node) {
		d := report(c, ret.Expression(), EK2128, nodeText(file, ret.Expression()))
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
	producerReturns(c, fix.SourceFile, func(ret *ast.Node) {
		if len(actions) == 0 && nodeStart(fix.SourceFile, ret.Expression()) == fix.Span.Pos() {
			end := ret.End()
			if text := fix.SourceFile.Text(); end > 0 && text[end-1] == ';' {
				end--
			}
			actions = append(actions, &ls.CodeAction{Description: "End the stream without a value", Changes: replaceRange(fix, nodeStart(fix.SourceFile, ret), end, producerReturnRewrite(c, fix.SourceFile, ret))})
		}
	})
	return actions, nil
}
