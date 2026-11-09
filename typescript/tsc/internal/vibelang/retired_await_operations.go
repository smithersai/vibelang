package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK1802: a retired await operation (VIP-18). {0} is the operation.
var EK1802 = message(1802, errorCategory, "{0} was removed by VIP-18: write try.all, try.race, try.any or try.allSettled over an array of Effects, or try all({ … }, { concurrency: \"unbounded\" }) for an object.")

func init() {
	registry[EK1802.Code] = EK1802
	fileChecks = append(fileChecks, checkRetiredAwaitOperations)
}

func checkRetiredAwaitOperations(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := awaitOperationNames[fiberHelper(node)]; name != "" {
			message := EK1802
			if inAsyncFunction(node) {
				copy := *EK1802
				copy.Text = "{0} was removed by VIP-18. In async code, construct the corresponding Effect operation and await Effect.runPromise(...); try.all, try.race, try.any and try.allSettled require effect code."
				message = &copy
			}
			report(c, node, message, name)
			cover(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
