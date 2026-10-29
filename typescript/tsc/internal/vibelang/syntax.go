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
// an Effect there is EK4617, since an Effect goes through runPromise first
// (VIP-5). Outside an async function a call already waits, so for await and
// await using are EK1003 (Chapter 10). The parser writes await outside an
// async function as $await (fibers.go), so an AwaitExpression here is inside
// an async function. D271 exempts
// explicit JavaScript iterator generators and their own body syntax.

var EK1017 = message(1017, errorCategory, "provide is a statement; write provide layer { statements } and return from inside its block.")

var EK1015 = message(1015, errorCategory, "Calls run in VibeLang; remove yield*.")

// EK4617: await on an Effect inside an async function (VIP-5). {0} is the operand.
var EK4617 = message(4617, errorCategory, "await waits for a promise, but {0} is an Effect, which await never runs.")

func init() {
	registry[EK1015.Code] = EK1015
	registry[EK1017.Code] = EK1017
	registry[EK4617.Code] = EK4617
	fileChecks = append(fileChecks, checkSyntax, checkThrowExpressionPrecedence)
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
			fn := ast.GetContainingFunction(node)
			if node.AsYieldExpression().AsteriskToken != nil && (fn == nil || ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator == 0) {
				report(c, node, EK1015)
				cover(c, node)
			}
		case ast.KindAwaitExpression:
			if operand := node.Expression(); isEffectType(c, c.GetTypeAtLocation(operand)) {
				text := nodeText(file, operand)
				note(reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK4617, shortText(text, "the operand")), "Run it to a promise first: await runPromise({0}).", text)
				cover(c, node) // the Effect the await leaves unrun restates EK4617
			}
		case ast.KindForOfStatement:
			if await := node.AsForInOrOfStatement().AwaitModifier; await != nil && !inAsyncFunction(node) {
				note(report(c, await, EK1003, "for await"), "Remove await: for...of over a producer or a Stream already waits.")
				cover(c, await)
			}
		case ast.KindVariableDeclarationList:
			switch node.Flags & ast.NodeFlagsBlockScoped {
			case ast.NodeFlagsAwaitUsing:
				if inAsyncFunction(node) {
					break
				}
				note(reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK1003, "await using"), "Write using: it already waits for the acquisition and the release.")
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

// throwExpressionPrecedenceOperand recognizes D186's parser-generated
// (() => { throw operand })() by both its shape and its source keyword.
// A handwritten IIFE starts with '(' instead; do/match IIFEs have other
// keywords. It returns the operand only where an operator applies to more
// than the throw (throwOperandEndsOperator).
func throwExpressionPrecedenceOperand(file *ast.SourceFile, node *ast.Node) *ast.Node {
	if node.Kind != ast.KindCallExpression || node.Parent == nil || node.Pos() < 0 || node.End() > len(file.Text()) {
		return nil
	}
	if !throwOperandEndsOperator(file, node) {
		return nil
	}
	keyword := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
	if file.Text()[keyword.Pos():keyword.End()] != "throw" {
		return nil
	}
	callee := node.Expression()
	if len(node.Arguments()) != 0 || callee.Kind != ast.KindParenthesizedExpression {
		return nil
	}
	arrow := callee.Expression()
	if arrow.Kind != ast.KindArrowFunction || arrow.Body() == nil || arrow.Body().Kind != ast.KindBlock {
		return nil
	}
	statements := arrow.Body().Statements()
	if len(statements) != 1 || statements[0].Kind != ast.KindThrowStatement {
		return nil
	}
	return statements[0].Expression()
}

// throwOperandEndsOperator reports whether text after node, a throw
// expression, belongs to an operator that the throw's unary operand leaves
// out: node, or an expression that node ends, is a binary operator's left
// operand (except comma), a conditional's condition, or the operand of as or
// satisfies. `x ?? throw c ? a : b` is `(x ?? throw c) ? a : b`, so it
// throws only c, as `throw c ? a : b` does. Parentheses end the search, so a
// parenthesized throw or operand stays explicit, and right operands and
// conditional arms stay legal.
func throwOperandEndsOperator(file *ast.SourceFile, node *ast.Node) bool {
	for ; node.Parent != nil; node = node.Parent {
		parent := node.Parent
		switch parent.Kind {
		case ast.KindBinaryExpression:
			binary := parent.AsBinaryExpression()
			if binary.Left == node {
				return binary.OperatorToken.Kind != ast.KindCommaToken
			}
			// node ends the right operand, so it ends parent too.
		case ast.KindConditionalExpression:
			conditional := parent.AsConditionalExpression()
			if conditional.Condition == node {
				return true
			}
			if conditional.WhenFalse != node {
				return false // : closes the first arm
			}
		case ast.KindAsExpression, ast.KindSatisfiesExpression:
			return parent.Expression() == node
		case ast.KindPropertyAccessExpression:
			// D272 normalizes throw x |> f(args)(%) to (throw x).pipe(f(args)).
			// Its generated 'pipe' name is anchored on '|', unlike a written member.
			if parent.Expression() != node || parent.Name().Text() != "pipe" {
				return false
			}
			operator := scanner.GetRangeOfTokenAtPosition(file, parent.Name().Pos())
			return file.Text()[operator.Pos():operator.End()] == "|"
		default:
			return false
		}
	}
	return false
}

// EK1010 checks parser-generated throw expressions even in a hatch's
// TypeScript callback: D148 keeps throw statements there, but the same
// unary expression grammar must not silently discard the remaining text.
// The existing checkSyntax keeps its keyword/using positions and hatch gate.
func checkThrowExpressionPrecedence(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if operand := throwExpressionPrecedenceOperand(file, node); operand != nil {
			report(c, node, EK1010, scanner.GetSourceTextOfNodeFromSourceFile(file, operand, false))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
