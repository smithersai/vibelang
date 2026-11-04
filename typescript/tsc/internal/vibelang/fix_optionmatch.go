package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/nodebuilder"
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
	handlerType := c.GetTypeAtLocation(handlers)
	format := checker.TypeFormatFlagsNoTruncation | checker.TypeFormatFlagsUseFullyQualifiedType | checker.TypeFormatFlagsUseSourceScope
	handlersType := c.TypeToStringEx(handlerType, handlers, format, nil)
	prefix := "do { const "
	handlersAnnotation := ": " + handlersType
	destructureAnnotation := ""
	// Option.match accepts a callback that ignores its argument. Keep its
	// contextual type at the first binding, then widen only the extracted
	// callable to accept the ignored value as unknown. A local unique symbol
	// is named through its source scope. If a factory keeps that symbol
	// private, infer the factory result and use scoped type queries instead.
	actualSome := c.GetPropertyOfType(c.GetTypeAtLocation(handlers), "onSome")
	if actualSome != nil {
		for _, signature := range c.GetSignaturesOfType(c.GetTypeOfSymbol(actualSome), checker.SignatureKindCall) {
			parameters := c.GetExpandedParameters(signature, true)
			if len(parameters) != 1 || len(parameters[0]) != 0 {
				continue
			}
			// An opaque factory return can contain a unique symbol that has no
			// name here. Detect the type operator, not a string literal with
			// the words "unique symbol", before choosing inference.
			typeNode := c.TypeToTypeNode(handlerType, handlers, nodebuilder.Flags(format)|nodebuilder.FlagsIgnoreErrors, nil)
			var unnamedSymbol func(*ast.Node) bool
			unnamedSymbol = func(n *ast.Node) bool {
				return n.Kind == ast.KindTypeOperator && n.AsTypeOperatorNode().Operator == ast.KindUniqueKeyword || n.ForEachChild(unnamedSymbol)
			}
			if typeNode != nil && unnamedSymbol(typeNode) {
				handlersAnnotation = ""
			}
			result := names.freshName("$optionResult")
			args := names.freshName("$optionArgs")
			destructureAnnotation = ": { readonly onNone: (typeof " + callbacks + ")[\"onNone\"]; readonly onSome: (" + payload +
				": unknown) => ((typeof " + callbacks +
				")[\"onSome\"] extends (..." + args + ": never[]) => infer " + result + " ? " + result + " : never); }"
			break
		}
	}
	// At the start of an expression statement, do denotes do/while.
	// A plain block preserves the discarded result and callback order.
	if ast.IsExpressionStatement(call.Parent) {
		prefix = "{ const "
	}
	text := prefix + input + " = " + expressionText(file, value) + "; const " + callbacks + handlersAnnotation + " = " + expressionText(file, handlers) +
		"; const { onNone: " + none + ", onSome: " + some + " }" + destructureAnnotation + " = " + callbacks + "; match (" + input + ") { when " + option + ".Some(let " + payload + "): " + some + "(" + payload + "); default: " + none + "(); }; }"
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
