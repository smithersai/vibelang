package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The style rules of Effect's language service that still apply to .vibe
// code (D240). Each is off until a project or a comment turns it on (D241).

var (
	// EK4821 (schemaStructWithTag): Schema.Struct with a literal _tag field. {0} is the tag.
	EK4821 = messageOff(4821, "This Schema.Struct has a _tag field; Schema.TaggedStruct(\"{0}\", …) writes it and fills it in when you make a value.")
	// EK4822 (strictBooleanExpressions): a condition that is not a boolean. {0} is its type.
	EK4822 = messageOff(4822, "This condition is {0}, not a boolean.")
	// EK4823 (unnecessaryArrowBlock): an arrow function whose block only returns.
	EK4823 = messageOff(4823, "This arrow function's block only returns a value; write the value as its body.")
	// EK4824 (unnecessaryPipe): a pipe with no functions.
	EK4824 = messageOff(4824, "This pipe has no functions, so it returns its value unchanged.")
	// EK4825 (unnecessaryPipeChain): a pipe of a pipe.
	EK4825 = messageOff(4825, "This pipe continues another; pass all the functions to one pipe.")
)

func init() {
	for _, m := range []*Message{EK4821, EK4822, EK4823, EK4824, EK4825} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkStyleRules)
	ls.RegisterCodeFixProvider(styleFix)
}

// checkStyleRules reports EK4821-EK4825 in file.
func checkStyleRules(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsVibeLang != 0 {
			return node.ForEachChild(visit) // the parser wrote it, as for a schema declaration
		}
		switch {
		case ast.IsCallExpression(node):
			if tag, _ := taggedStructOf(c, node); tag != "" {
				report(c, node, EK4821, tag)
			}
			switch pipeFormOf(c, node) {
			case pipeEmpty:
				report(c, node, EK4824)
			case pipeChain:
				report(c, node, EK4825)
			}
		case ast.IsArrowFunction(node) && !isEffectBlock(node):
			// An effect block, effect { … }, parses as an arrow, but its braces
			// are its syntax (Appendix A, EffectBlock): only a real arrow can
			// drop them. Its body is still visited, for the arrows inside it.
			if returnedValue(node) != nil {
				report(c, node.Body(), EK4823)
			}
		}
		for _, condition := range conditionsOf(node) {
			checkCondition(c, condition)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// taggedStructOf returns the tag of call, a Schema.Struct call whose object
// has a _tag field of Schema.Literal("tag"), and that field; or "".
func taggedStructOf(c *checker.Checker, call *ast.Node) (string, *ast.Node) {
	arguments := call.Arguments()
	if len(arguments) != 1 || !ast.IsObjectLiteralExpression(arguments[0]) {
		return "", nil
	}
	if module, name := effectFunctionOf(c, call.Expression()); module != "Schema" || name != "Struct" {
		return "", nil
	}
	for _, property := range arguments[0].AsObjectLiteralExpression().Properties.Nodes {
		if !ast.IsPropertyAssignment(property) || property.Name() == nil || !ast.IsIdentifier(property.Name()) || property.Name().Text() != "_tag" {
			continue
		}
		literal := property.Initializer()
		if !ast.IsCallExpression(literal) || len(literal.Arguments()) != 1 || !ast.IsStringLiteral(literal.Arguments()[0]) {
			return "", nil
		}
		if module, name := effectFunctionOf(c, literal.Expression()); module == "Schema" && name == "Literal" {
			return literal.Arguments()[0].Text(), property
		}
	}
	return "", nil
}

type pipeForm uint8

const (
	pipeOther pipeForm = iota
	pipeEmpty          // pipe(x) or x.pipe()
	pipeChain          // pipe(pipe(x, f), g) or x.pipe(f).pipe(g)
)

// pipeFormOf says whether call is a pipe with no functions or a pipe of a
// pipe: effect's pipe function or a value's pipe method.
func pipeFormOf(c *checker.Checker, call *ast.Node) pipeForm {
	switch receiver := pipeReceiver(c, call); {
	case receiver == nil:
		return pipeOther
	case len(pipeFunctions(call)) == 0:
		return pipeEmpty
	case ast.IsCallExpression(receiver) && pipeReceiver(c, receiver) != nil && len(pipeFunctions(receiver)) > 0 && isMethodPipe(call) == isMethodPipe(receiver):
		return pipeChain
	}
	return pipeOther
}

// pipeReceiver returns the value that call, a pipe, pipes: pipe's first
// argument or the pipe method's receiver. It returns nil for any other call.
func pipeReceiver(c *checker.Checker, call *ast.Node) *ast.Node {
	callee := call.Expression()
	if isMethodPipe(call) {
		// A curried native |> stage gets a synthesized .pipe for contextual
		// typing. Its method name was not written and is not a lint target.
		if callee.Name().Flags&ast.NodeFlagsReparserTransformedLiteral != 0 {
			return nil
		}
		if module, _ := effectFunctionOf(c, callee); module == "Pipeable" {
			return callee.Expression()
		}
		return nil
	}
	if module, name := effectFunctionOf(c, callee); module == "Function" && name == "pipe" && len(call.Arguments()) > 0 {
		return call.Arguments()[0]
	}
	return nil
}

// isMethodPipe reports whether call calls a method named pipe.
func isMethodPipe(call *ast.Node) bool {
	callee := call.Expression()
	return ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "pipe"
}

// pipeFunctions returns the functions that call, a pipe, applies.
func pipeFunctions(call *ast.Node) []*ast.Node {
	if isMethodPipe(call) {
		return call.Arguments()
	}
	return call.Arguments()[1:]
}

// returnedValue returns the value that arrow's block returns when the block
// holds nothing but that return statement, or nil.
func returnedValue(arrow *ast.Node) *ast.Node {
	body := arrow.Body()
	if !ast.IsBlock(body) || len(body.Statements()) != 1 || !ast.IsReturnStatement(body.Statements()[0]) {
		return nil
	}
	if strings.Contains(scanner.GetTextOfNode(body), "//") || strings.Contains(scanner.GetTextOfNode(body), "/*") {
		return nil // keep the comments the block holds
	}
	return body.Statements()[0].Expression()
}

// conditionsOf returns the conditions that node tests: an if, while, do,
// or for statement's, a conditional expression's, and the operand of !.
func conditionsOf(node *ast.Node) []*ast.Node {
	var condition *ast.Node
	switch node.Kind {
	case ast.KindIfStatement, ast.KindWhileStatement, ast.KindDoStatement:
		condition = node.Expression()
	case ast.KindForStatement:
		condition = node.AsForStatement().Condition
	case ast.KindConditionalExpression:
		condition = node.AsConditionalExpression().Condition
	case ast.KindPrefixUnaryExpression:
		if node.AsPrefixUnaryExpression().Operator == ast.KindExclamationToken {
			condition = node.AsPrefixUnaryExpression().Operand
		}
	}
	if condition == nil {
		return nil
	}
	return []*ast.Node{condition}
}

// checkCondition reports EK4822 at condition, or at the operands of the
// && and || that it is made of, when its type is not boolean.
func checkCondition(c *checker.Checker, condition *ast.Node) {
	condition = ast.SkipParentheses(condition)
	if ast.IsBinaryExpression(condition) {
		switch condition.AsBinaryExpression().OperatorToken.Kind {
		case ast.KindAmpersandAmpersandToken, ast.KindBarBarToken:
			checkCondition(c, condition.AsBinaryExpression().Left)
			checkCondition(c, condition.AsBinaryExpression().Right)
			return
		}
	}
	t := c.GetTypeAtLocation(condition)
	for _, member := range t.Distributed() {
		if member.Flags()&(checker.TypeFlagsBooleanLike|checker.TypeFlagsNever) == 0 {
			note(report(c, condition, EK4822, c.TypeToString(t)), "Write the comparison you mean, such as x !== 0, x !== \"\" or x !== undefined.")
			return
		}
	}
}

// styleFix repairs EK4821, EK4823, EK4824, and EK4825.
var styleFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4821.Code, EK4823.Code, EK4824.Code, EK4825.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		file := fix.SourceFile
		text := func(node *ast.Node) string { return scanner.GetTextOfNode(node) }
		if fix.ErrorCode == EK4823.Code {
			body := reportedNode(file, fix.Span, func(node *ast.Node) bool {
				return ast.IsBlock(node) && node.Parent != nil && ast.IsArrowFunction(node.Parent)
			})
			if body == nil || returnedValue(body.Parent) == nil {
				return nil, nil
			}
			returned := returnedValue(body.Parent)
			value := text(returned)
			// A concise body that starts with { is a block, and a comma there
			// ends the arrow: (n) => { return n, 1 } in a call would pass 1 as
			// another argument.
			if ast.IsObjectLiteralExpression(ast.SkipParentheses(returned)) || ast.IsBinaryExpression(returned) && returned.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
				value = "(" + value + ")"
			}
			return []*ls.CodeAction{{Description: "Write the value as the body", Changes: replaceRange(fix, nodeStart(file, body), body.End(), value)}}, nil
		}
		call := reportedNode(file, fix.Span, ast.IsCallExpression)
		if call == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
		defer done()
		var description, newText string
		var kept []*ast.Node
		switch fix.ErrorCode {
		case EK4821.Code:
			// TaggedStruct changes make input and constructor behavior.
			return nil, nil
		case EK4824.Code:
			kept = []*ast.Node{pipeReceiver(c, call)}
			description, newText = "Remove the pipe", text(kept[0])
		case EK4825.Code:
			inner := pipeReceiver(c, call)
			functions := append(slices.Clone(pipeFunctions(inner)), pipeFunctions(call)...)
			var texts []string
			for _, f := range functions {
				texts = append(texts, text(f))
			}
			kept = append([]*ast.Node{pipeReceiver(c, inner)}, functions...)
			if isMethodPipe(call) {
				newText = text(kept[0]) + ".pipe(" + strings.Join(texts, ", ") + ")"
			} else {
				kept = append(kept, call.Expression())
				newText = text(call.Expression()) + "(" + text(kept[0]) + ", " + strings.Join(texts, ", ") + ")"
			}
			description = "Pass every function to one pipe"
		}
		if commentBetween(file, nodeStart(file, call), call.End(), kept) {
			return nil, nil // the repair writes its own punctuation there
		}
		return []*ls.CodeAction{{Description: description, Changes: replaceRange(fix, nodeStart(file, call), call.End(), newText)}}, nil
	},
}

// commentBetween reports whether file's text in [start, end), outside the
// nodes a repair keeps, holds a comment the repair would drop. A repair that
// would drop a comment is not offered (chapter 7, Effect's type-aware lint).
func commentBetween(file *ast.SourceFile, start, end int, kept []*ast.Node) bool {
	kept = slices.Clone(kept)
	slices.SortFunc(kept, func(a, b *ast.Node) int { return nodeStart(file, a) - nodeStart(file, b) })
	text := file.Text()
	for _, node := range kept {
		if from := nodeStart(file, node); from > start && hasComment(text[start:from]) {
			return true
		}
		start = max(start, node.End())
	}
	return start < end && hasComment(text[start:end])
}
