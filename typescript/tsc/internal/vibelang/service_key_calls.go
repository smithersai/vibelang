package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A service key called with arguments is EK9214 (Chapter 4, D415): get the
// service, then call it (VIP-10), so Fn(3) for
// service Fn: (n: number) => number means (try Fn)(3). It replaces
// TypeScript's TS2348, whose suggestion of new would be EK3003, and its quick
// fix writes (try Fn)(3) in effect code.

// EK9214: a service key called with arguments. {0} is the service.
var EK9214 = message(9214, errorCategory, "{0} is a service key, which takes no arguments: try {0} gets its implementation.")

func init() {
	registry[EK9214.Code] = EK9214
	fileChecks = append(fileChecks, checkServiceKeyCalls)
}

func checkServiceKeyCalls(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if ast.IsCallExpression(node) && len(node.Arguments()) > 0 {
			if service := serviceNamedBy(c, node.Expression()); service != nil && classKindOf(service) == serviceClass {
				name := scanner.GetTextOfNode(node.Expression())
				d := report(c, node, EK9214, name)
				if serviceCallable(c, service) {
					note(d, "Get the service, then call it: (try {0})(…).", name)
				} else {
					note(d, "Get the service, then use a member: (try {0}).member(…).", name)
				}
				// TS2348: the key is not callable (did you mean new); TS2349 and
				// TS2554 for the same call through VibeLang's call hook.
				// Only the outer invocation is redundant; nested argument calls
				// retain their own native call and arity diagnostics.
				coverExactErrorCodes(c, node, 2348, 2554)
				coverExactErrorCodes(c, node.Expression(), 2349)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// serviceCallable reports whether service's implementation, what service()
// returns, is a function: its shape, service Fn: Shape, has call signatures.
func serviceCallable(c *checker.Checker, service *ast.Node) bool {
	shape := serviceShape(service)
	return shape != nil && len(c.GetSignaturesOfType(c.GetTypeFromTypeNode(shape), checker.SignatureKindCall)) > 0
}
