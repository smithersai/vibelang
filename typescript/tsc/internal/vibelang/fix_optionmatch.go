package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Direct Option.match is an eager choice. Keep callback construction, property
// reads, defaults and early returns at their original function boundaries.
func optionMatchOf(c *checker.Checker, call *ast.Node) bool {
	return ast.IsCallExpression(call) && call.QuestionDotToken() == nil && call.TypeArguments() == nil && len(call.Arguments()) == 2 && isEffectFunction(c, call.Expression(), "Option", "match") && !inHatch(call)
}

func optionMatchRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !optionMatchOf(c, call) {
		return nil
	}
	if analyzerFor(c).runs(call) || holdsEffectValue(c, c.GetTypeAtLocation(call)) {
		return &formRewrite{why: "No quick fix: the Option choice returns a program, which a native arm could run."}
	}
	value, handlers := call.Arguments()[0], call.Arguments()[1]
	if hasComment(file.Text()[nodeStart(file, call):nodeStart(file, value)]) || hasComment(file.Text()[value.End():nodeStart(file, handlers)]) || hasComment(file.Text()[handlers.End():call.End()]) {
		return &formRewrite{why: "No quick fix: a comment stands between Option.match's arguments."}
	}
	option := expressionText(file, call.Expression().Expression())
	if ast.IsSpreadElement(value) || ast.IsSpreadElement(handlers) {
		return nil
	}
	// The original callback values remain callbacks. The Some arm reads its
	// payload once, as Option.match does; None never reads it.
	names := &freshNames{file: file}
	input := names.freshName("$optionSubject")
	callbacks := names.freshName("$optionHandlers")
	payload := names.freshName("$optionValue")
	none := names.freshName("$optionNone")
	some := names.freshName("$optionSome")
	handlersType := c.TypeToStringEx(c.GetTypeAtLocation(handlers), handlers, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
	prefix := "do { const "
	// At the start of an expression statement, do denotes do/while.
	// A plain block preserves the discarded result and callback order.
	if ast.IsExpressionStatement(call.Parent) {
		prefix = "{ const "
	}
	text := prefix + input + " = " + expressionText(file, value) + "; const " + callbacks + ": " + handlersType + " = " + expressionText(file, handlers) +
		"; const { onNone: " + none + ", onSome: " + some + " } = " + callbacks + "; match (" + input + ") { when " + option + ".Some(let " + payload + "): " + some + "(" + payload + "); default: " + none + "(); }; }"
	if !ast.IsExpressionStatement(call.Parent) {
		// A call/property/binary chain can begin an expression statement too.
		// Keep do in expression position when this call supplies its first token.
		for parent := call.Parent; parent != nil; parent = parent.Parent {
			if ast.IsExpressionStatement(parent) {
				if nodeStart(file, parent.Expression()) == nodeStart(file, call) {
					text = "(" + text + ")"
				}
				break
			}
		}
	}
	return withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{nodeStart(file, call), call.End(), text}}, description: "an eager native Option match"})
}
