package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-4 and chapter 2's Result tests: every native invocation that may
// produce a Promise needs an explicit boundary, including a union result,
// constructors and selected tag signatures. Plain source functions remain
// JavaScript boundaries; neither any, unknown nor never establishes a Promise.
func promiseInvocation(node *ast.Node) bool {
	if ast.IsCallExpression(node) {
		callee := ast.SkipParentheses(node.Expression())
		// Source program forms have their own checks. In particular, the
		// VIP-7 async-match implementation owns its Promise-creation gate.
		if isProgramArrow(callee) {
			return false
		}
		return callee.Flags&ast.NodeFlagsReparsed == 0
	}
	return ast.IsTaggedTemplateExpression(node) || ast.IsNewExpression(node)
}

func unwrappedPromiseInvocation(c *checker.Checker, node *ast.Node) bool {
	if !promiseInvocation(node) || !inEffectCode(node) || inHatch(node) {
		return false
	}
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) && ast.HasSyntacticModifier(n, ast.ModifierFlagsAsync) {
			return false
		}
		if ast.IsFunctionLike(n) && !isCalledInPlace(n) {
			break
		}
	}
	// Runtime import is an intrinsic with no ordinary resolved signature.
	if ast.IsImportCall(node) {
		return mayBeThenable(c, c.GetTypeAtLocation(node))
	}
	// The expression type of a tried Effect call is its success value.
	// Classify the selected native signature before try unwraps that data.
	signature := c.GetResolvedSignature(node)
	return signature != nil && mayBeThenable(c, c.GetReturnTypeOfSignature(signature))
}

func init() {
	fileChecks = append(fileChecks, checkPromiseInvocations)
}

func checkPromiseInvocations(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if unwrappedPromiseInvocation(c, node) {
			d := reportAt(c, file, tsFormSpan(file, node), EK0404)
			note(d, "Run the native invocation inside Effect.tryPromise(async () => …). To retain its Promise as unawaited data, use a synchronous Effect.try boundary instead.")
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
