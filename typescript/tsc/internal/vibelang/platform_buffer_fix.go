package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK4402's quick fix for counting a string's UTF-8 bytes. TextEncoder is on
// chapter 5's allowlist of web data utilities with no I/O, and it encodes the
// bytes Buffer.byteLength counts, a lone surrogate included, so in plain code
// and effect code alike
//
//	Buffer.byteLength(text, "utf8")     new TextEncoder().encode(text).length
//
// returns the same number, adds no requirement, and leaves the declaration as
// it was. No service fits: Effect has none for this, and reaching one from
// plain code would change the function's type. The fix stands when the
// argument is a string and the encoding is absent or UTF-8; elsewhere EK4402
// says why there is none. vibelang --fix applies it.

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4402.Code}, GetCodeActions: bufferByteLengthFix})
}

// bufferByteLengthCall returns the call that use, Buffer.byteLength as EK4402
// reports it, makes; or nil.
func bufferByteLengthCall(use *ast.Node) *ast.Node {
	if use == nil || !ast.IsPropertyAccessExpression(use) {
		return nil
	}
	object, name := use.Expression(), use.AsPropertyAccessExpression().Name()
	if !ast.IsIdentifier(object) || object.Text() != "Buffer" || name.Text() != "byteLength" {
		return nil
	}
	call := use.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() != use {
		return nil
	}
	return call
}

// bufferByteLengthRefusal returns why the fix does not stand at call, a
// Buffer.byteLength call in file, or "" when it does.
func bufferByteLengthRefusal(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	const write = "new TextEncoder().encode(text).length counts a string's UTF-8 bytes"
	arguments := call.Arguments()
	if call.QuestionDotToken() != nil || call.Expression().QuestionDotToken() != nil {
		return "this optional call may not run; " + write + "."
	}
	if len(arguments) == 0 || len(arguments) > 2 || ast.IsSpreadElement(arguments[0]) {
		return write + ", and this call does not pass one string."
	}
	if len(arguments) == 2 && !isUTF8Literal(arguments[1]) {
		return write + ", and this call names another encoding."
	}
	value := c.GetTypeAtLocation(arguments[0])
	if value == nil || value.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 || !c.IsTypeAssignableTo(value, c.GetStringType()) {
		return write + ", and this value is not always a string."
	}
	if encoder := c.GlobalSymbol("TextEncoder", ast.SymbolFlagsValue); encoder == nil || c.ResolveName("TextEncoder", call, ast.SymbolFlagsValue, false) != encoder {
		return "TextEncoder here is not the global one."
	}
	// The fix rewrites the text after the argument, so a comment there would be lost.
	if tail := file.Text()[arguments[0].End():call.End()]; strings.Contains(tail, "/*") || strings.Contains(tail, "//") {
		return "a comment follows the argument; " + write + "."
	}
	return ""
}

// isUTF8Literal reports whether node is the string "utf8" or "utf-8", which
// are the spellings of Buffer's default encoding that a reader can see.
func isUTF8Literal(node *ast.Node) bool {
	return (ast.IsStringLiteral(node) || node.Kind == ast.KindNoSubstitutionTemplateLiteral) && (node.Text() == "utf8" || node.Text() == "utf-8")
}

func bufferByteLengthFix(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	use := reportedNode(fix.SourceFile, fix.Span, ast.IsPropertyAccessExpression)
	call := bufferByteLengthCall(use)
	if call == nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	refused := bufferByteLengthRefusal(c, fix.SourceFile, call)
	done()
	if refused != "" {
		return nil, nil
	}
	// Two edits, so a nested call's own fix does not overlap this one.
	argument := call.Arguments()[0]
	edits := replaceRange(fix, nodeStart(fix.SourceFile, use), use.End(), "new TextEncoder().encode")
	edits = append(edits, replaceRange(fix, argument.End(), call.End(), ").length")...)
	return []*ls.CodeAction{{Description: "Count the bytes with TextEncoder", Changes: edits}}, nil
}
