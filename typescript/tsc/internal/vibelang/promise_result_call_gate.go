package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
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
	tsFormFixCodes = append(tsFormFixCodes, EK0404.Code)
	ls.RegisterCodeFixProvider(promiseInvocationFix)
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

// --fix preserves the Promise as data, its identity and synchronous timing.
// Effect.try does not assimilate its success; orDie retains the original
// synchronous defect policy. Awaiting with tryPromise would change the value.
var promiseInvocationFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK0404.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		node := tsFormNodeAt(fix.SourceFile, fix.Span, promiseInvocation)
		if node == nil || isTry(node) {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		if !unwrappedPromiseInvocation(c, node) {
			return nil, nil
		}
		if implicitEffectModuleDisabled(c, fix.SourceFile, "Effect") && !shadowedByValue(node, "Effect") {
			return nil, nil
		}
		visible := c.ResolveName("Effect", node, ast.SymbolFlagsValue, false)
		if visible != nil && visible.Flags()&ast.SymbolFlagsAlias != 0 {
			visible = c.GetAliasedSymbol(visible)
		}
		official := effectModuleNamespace(c, fix.SourceFile, "Effect")
		if visible == nil || official == nil || c.GetMergedSymbol(visible) != c.GetMergedSymbol(official) {
			return nil, nil
		}

		// The outer boundary includes all its native operands. Do not emit
		// overlapping inner edits or move an Effect operation into a plain thunk.
		for n := node.Parent; n != nil && !isFunctionBoundary(n); n = n.Parent {
			if unwrappedPromiseInvocation(c, n) {
				return nil, nil
			}
		}
		var unsafe func(*ast.Node) bool
		unsafe = func(n *ast.Node) bool {
			if ast.IsFunctionLike(n) {
				return false
			}
			return isTry(n) || isTopic(n) || ast.IsAwaitExpression(n) || ast.IsYieldExpression(n) || (isInvocation(n) && analyzerFor(c).performs(n)) || isDoExpressionCall(n) || n.ForEachChild(unsafe)
		}
		if node.ForEachChild(unsafe) {
			return nil, nil
		}
		text := "try Effect.orDie(Effect.try({ try: () => " + nodeText(fix.SourceFile, node) + ", catch: (error) => error }))"
		if !standsAlone(node) {
			text = "(" + text + ")"
		}
		changes := replaceRange(fix, nodeStart(fix.SourceFile, node), node.End(), text)
		return []*ls.CodeAction{{Description: "Keep the native Promise as data through Effect.try", Changes: changes}}, nil
	},
}
