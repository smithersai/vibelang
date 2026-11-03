package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// The checks in this file report TypeScript syntax that VibeLang does not
// have. An async function means what it means in TypeScript (VIP-1): its body
// is TypeScript, as a hatch's is, where await waits for a promise; awaiting
// an Effect there is EK0103, since an Effect goes through runPromise first
// (VIP-5). Native loops keep their TypeScript protocols and operand checks.
// A for await in an Effect body is EK0102; it never implicitly consumes a
// Stream (VIP-20, detail293). Await using in Effect code is EK0102 too.
// The parser writes await outside an
// async function as $await (fibers.go), so an AwaitExpression here is inside
// an async function. D271 exempts
// explicit JavaScript iterator generators and their own body syntax.

var EK1017 = message(1017, errorCategory, "provide is a statement; write provide layer { statements } and return from inside its block.")

var EK1015 = message(1015, errorCategory, "Calls run in VibeLang; remove yield*.")

// EK0103: await on an Effect inside an async function (VIP-5). {0} is the operand.
var EK0103 = message(103, errorCategory, "await waits for a promise, but {0} is an Effect, which await never runs.")

func init() {
	registry[EK1015.Code] = EK1015
	registry[EK1017.Code] = EK1017
	registry[EK0103.Code] = EK0103
	fileChecks = append(fileChecks, checkSyntax)
}

func checkSyntax(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if hatchOf(node) != "" {
			return forEachHatchVibeLang(node, visit) // async and await keep their JavaScript meaning in a hatch's TypeScript (D148)
		}
		if fn := ast.GetContainingFunction(node); fn != nil && !isFunctionBoundary(node) &&
			ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator != 0 && vibelangmapper.HasJavaScriptIteratorReturn(fn) {
			// Await, for await and await using are JavaScript inside this
			// generator. Nested functions still own their VibeLang rules.
			return node.ForEachChild(visit)
		}
		switch node.Kind {
		case ast.KindYieldExpression:
			fn := yieldBodyFunction(file, node)
			if node.AsYieldExpression().AsteriskToken != nil && (fn == nil || ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator == 0) {
				report(c, node, EK1015)
				cover(c, node)
			}
		case ast.KindAwaitExpression:
			if operand := node.Expression(); isEffectType(c, c.GetTypeAtLocation(operand)) {
				text := nodeText(file, operand)
				note(reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK0103, shortText(text, "the operand")), "Run it to a promise first: await runPromise({0}).", text)
				cover(c, node) // the Effect the await leaves unrun restates EK0103
			}
		case ast.KindForOfStatement:
			if await := node.AsForInOrOfStatement().AwaitModifier; await != nil && inLowerableBody(node) && analyzerFor(c).isEffect(ast.GetContainingFunction(node)) {
				note(report(c, await, EK0102), "Use for try to consume a Stream in effect code; for await is for AsyncIterables in async code.")
				cover(c, await)
			}
		case ast.KindVariableDeclarationList:
			switch node.Flags & ast.NodeFlagsBlockScoped {
			case ast.NodeFlagsAwaitUsing:
				if inAsyncFunction(node) {
					break
				}
				if inLowerableBody(node) && analyzerFor(c).isEffect(ast.GetContainingFunction(node)) {
					note(reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK0102), "Use scoped and acquireRelease for Effect resources; await using belongs in async code.")
				} else {
					note(reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK1003, "await using"), "Write using: it already waits for the acquisition and the release.")
				}
				cover(c, node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// inAsyncFunction reports whether node is in the body of an async function,
// whose code is TypeScript (VIP-1).
func inAsyncFunction(node *ast.Node) bool {
	fn := ast.GetContainingFunction(node)
	return fn != nil && ast.GetFunctionFlags(fn)&ast.FunctionFlagsAsync != 0
}

// isAtModuleTopLevel reports whether node runs as part of its module's top
// level: no function encloses it. A class static block runs when the module
// defines the class, so it counts as the top level.
func isAtModuleTopLevel(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLikeDeclaration(n) {
			return false
		}
	}
	return true
}
