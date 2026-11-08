package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// vibelang --fix-vip-only writes try before each call that ran where it
// stood before VIP-1 (legacyRunOf, fix_legacy_runs.go): a call in effect
// code whose result is an Effect, in any position that ran it, a match or
// conditional arm, either side of ?? or ||, a do expression's result or an
// effect arrow's expression body as much as a statement. `try f()` means
// what f() meant there, so the program keeps its meaning (decided detail
// 274). It writes none where a call was passed or held unrun: an await
// operation's element, the operand of fork, an argument passed by name, a
// held const or field, a hatch body, a module's top level, or a function
// literal whose body is the call alone, () => f(), which returns the call's
// program; nor before fork(x), the keyword form fork x written as a call;
// nor before the left side of x catch y or a call in it, which the catch
// runs. Where the model can't tell whether a call ran, as in a function
// whose form the old compiler inferred, it writes nothing and reports the
// site. A call whose value a chain continues, as f() in f().name, is written
// (try f()).name; one that an optional chain continues, a?.f().g(), keeps
// its chain and gets no try.

// tryLabel, effectLabel and untriedLabel are the kinds of rewrite, as the
// --fix report names them: a try written before a call, an effect mark
// written on a function that the old compiler made an Effect function, and a
// try removed before a legacy wrapper's call (wrapperTry).
const (
	valueCallLabel = "Effect value call"
)

// tried reports whether call is already the operand of a try, written
// around parentheses: try (f()).
func tried(call *ast.Node) bool {
	for n := call.Parent; n != nil && ast.IsParenthesizedExpression(n); n = n.Parent {
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return true
		}
	}
	return false
}

// isCatchLeft reports whether node, parentheses aside, is the left side of
// x catch y, which the parser passes to $catchExpression as the body of a
// function: the catch runs it.
func isCatchLeft(node *ast.Node) bool {
	n := node
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	arrow := n.Parent
	if arrow == nil || !ast.IsArrowFunction(arrow) || arrow.Body() != n {
		return false
	}
	call := arrow.Parent
	return call != nil && catchExpressionOf(call) != nil && len(call.Arguments()) > 0 && call.Arguments()[0] == arrow
}

// inCatchLeft reports whether node is the left side of x catch y, or in it
// outside a function it defines: the catch runs that side as one program.
func inCatchLeft(node *ast.Node) bool {
	for n := node; n != nil && n.Parent != nil; n = n.Parent {
		if isCatchLeft(n) {
			return true
		}
		if isFunctionBoundary(n) {
			return false
		}
	}
	return false
}

// tryNeedsParentheses reports whether try before call needs parentheses to
// apply to the call alone: the call is the object of a member access, the
// callee of a call, a template's tag, or the left side of **, which a unary
// expression cannot be.
func tryNeedsParentheses(call *ast.Node) bool {
	parent := call.Parent
	switch {
	case parent == nil:
		return false
	case ast.IsPropertyAccessExpression(parent), ast.IsElementAccessExpression(parent), ast.IsCallExpression(parent), ast.IsTaggedTemplateExpression(parent), ast.IsNonNullExpression(parent):
		return parent.Expression() == call
	case ast.IsBinaryExpression(parent):
		b := parent.AsBinaryExpression()
		return b.OperatorToken.Kind == ast.KindAsteriskAsteriskToken && b.Left == call
	}
	return false
}

// continuesStatement reports whether the ( that start, a call's first
// character, would gain could continue the line before it: start begins its
// statement, and the code before it ends without a semicolon or a brace.
func continuesStatement(text string, call *ast.Node, start int) bool {
	statement := call
	for statement.Parent != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if scanner.SkipTrivia(text, statement.Pos()) != start {
		return false
	}
	i := statement.Pos() - 1
	for i >= 0 && (text[i] == ' ' || text[i] == '\t' || text[i] == '\n' || text[i] == '\r') {
		i--
	}
	return i >= 0 && text[i] != ';' && text[i] != '{' && text[i] != '}'
}
