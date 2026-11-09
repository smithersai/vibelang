package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// A producer's Stream has no return value (VIP-21): `return value` in a
// producer is EK2128, and a bare `return` ends the stream. Before VIP-21 the
// value was evaluated and dropped, so the fix keeps its evaluation: `return`
// alone for a value that runs no code, `{ value; return }` otherwise. The fix
// applies only to a function marked effect. A plain function* is a JavaScript
// generator (VIP-21), whose caller can read the value through next() or
// yield*, so rewriting its return would lose data with nothing to flag it.

// EK2128: `return value` in a producer. {0} is the value.
// The parser reports the same code for a valued return in a do expression it
// still compiles to a function (parser.doProducerValuedReturn), which this
// file's walk does not enter.
var EK2128 = message(parser.ProducerReturnValueCode, errorCategory, parser.ProducerReturnValueMessage)

func init() {
	registry[EK2128.Code] = EK2128
	fileChecks = append(fileChecks, checkProducerReturns)
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
			note(d, "A JavaScript caller can read a plain function*'s return value; mark the function effect if it is a producer.")
			return
		}
	})
}
