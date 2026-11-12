package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK1802: a retired await operation (VIP-18). {0} is the operation and {1}
// the try operation that replaces it (Appendix B).
var EK1802 = message(1802, errorCategory, "{0} was removed by VIP-18: write {1}.")

// retiredAwaitReplacements keeps each operation's meaning: only await.all has
// an object counterpart, the all global; a race or an any written with it
// would wait for every Effect.
var retiredAwaitReplacements = map[string]string{
	"await.all":        "try.all over an array of Effects, or try all({ … }, { concurrency: \"unbounded\" }) for an object",
	"await.race":       "try.race over an array of Effects",
	"await.any":        "try.any over an array of Effects",
	"await.allSettled": "try.allSettled over an array of Effects",
}

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
			report(c, node, message, name, retiredAwaitReplacements[name])
			cover(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
