package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-21: a producer's Stream has no return value. A plain function* is a
// JavaScript generator whose caller can read its return value.

// EK2128: `return value` in a producer. {0} is the value.
// The parser reports the same code for a valued return in a do expression it
// still compiles to a function (parser.doProducerValuedReturn), which this
// file's walk does not enter.
var EK2128 = message(parser.ProducerReturnValueCode, errorCategory, parser.ProducerReturnValueMessage)

func init() {
	registry[EK2128.Code] = EK2128
	fileChecks = append(fileChecks, checkProducerReturns)
}

// producerReturns calls f with each valued return owned by an explicit producer.
// A call-site generator contract cannot change the producer marker (VIP-21).
func producerReturns(file *ast.SourceFile, f func(producer, ret *ast.Node)) {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isProducer(n) {
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

func checkProducerReturns(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	producerReturns(file, func(producer, ret *ast.Node) {
		report(c, ret.Expression(), EK2128, nodeText(file, ret.Expression()))
	})
}
