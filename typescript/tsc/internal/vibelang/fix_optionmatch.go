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
	handlersType := c.TypeToString(c.GetTypeAtLocation(handlers))
	text := "do { const " + input + " = " + expressionText(file, value) + "; const " + callbacks + ": " + handlersType + " = " + expressionText(file, handlers) +
		"; const { onNone: " + none + ", onSome: " + some + " } = " + callbacks + "; match (" + input + ") { when " + option + ".Some(let " + payload + "): " + some + "(" + payload + "); default: " + none + "(); }; }"
	return withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{nodeStart(file, call), call.End(), text}}, description: "an eager native Option match"})
}
