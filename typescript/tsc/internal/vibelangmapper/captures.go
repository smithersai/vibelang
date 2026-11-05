package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Captures. A match reads its subject once (D214): the parser captures the
// subject of a match, and of an is whose pattern binds names, in a const
// ($match1, $is2), and passes the subject of an is whose pattern reads it
// more than once to a function that tests its parameter
// (internal/parser/vibelang_match.go). The fork's checker narrows a subject
// that is an identifier expression, a name or this and property or literal
// element accesses, through its capture, as TypeScript narrows a switch's
// discriminant; stock TypeScript narrows only what a test reads. So for such
// a subject the checking rendering keeps the tests on the subject itself,
// as the parser wrote them before captures, and the executable rendering
// reads the capture, so a getter there runs once:
//
//	checking:    void shape.kind; { if (shape.kind === "circle") ... }
//	executable:  const match1 = shape.kind; { if (match1 === "circle") ... }
//
// A capture of any other subject, such as a call, is the same in both.

// captureDeclaration prints n when it is the const that captures a subject
// that is an identifier expression, and reports whether it is: the subject
// in place, as the statement void subject when checking and as the const
// when the program runs.
func (w *printer) captureDeclaration(n *ast.Node, e env) bool {
	declarations := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 {
		return false
	}
	name, subject := declarations[0].Name(), declarations[0].Initializer()
	if !isCapture(name) || subject == nil || !isIdentifierExpression(ast.SkipParentheses(subject)) {
		return false
	}
	w.capture(name, subject)
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{"void ", "const " + w.identifier(name) + " = "}})
	w.node(subject, e)
	w.write("; ")
	return true
}

// isFunction prints n when it is an is function the parser wrote,
// (($is1) => test)(subject), whose subject is an identifier expression, and
// reports whether it is: the test on the subject when checking, so the is
// narrows it where it stands, and the function when the program runs. A
// test that does not read the subject, such as a guard's, follows void
// subject when checking, so the subject still counts as read.
func (w *printer) isFunction(n *ast.Node) bool {
	arrow := ast.SkipParentheses(n.Expression())
	if !ast.IsArrowFunction(arrow) || len(n.Arguments()) != 1 || len(arrow.Parameters()) != 1 {
		return false
	}
	body := parser.MatchIsTest(arrow)
	if body == nil {
		return false
	}
	name, subject := arrow.Parameters()[0].Name(), n.Arguments()[0]
	if !isCapture(name) || !isIdentifierExpression(ast.SkipParentheses(subject)) {
		return false
	}
	w.capture(name, subject)
	if ast.IsBlock(arrow.Body()) {
		// Keep direct subject tests for TypeScript flow. The checking-only cache
		// declaration must remain visible after the generated function is inlined.
		if w.p.cacheWitnesses == nil {
			w.p.cacheWitnesses = map[string]bool{}
		}
		at := 0
		if len(w.p.file.Statements.Nodes) != 0 {
			at = w.p.tokenStart(w.p.file.Statements.Nodes[0])
		}
		for _, cache := range parser.VibeLangMatchCacheBindings(arrow.Body()) {
			local := w.identifier(cache)
			if !w.p.cacheWitnesses[local] {
				factory := w.p.names.helper("$matchCache")
				w.p.plan.witness(at, "declare const "+local+": typeof "+factory+" extends (...args: any[]) => infer Cached ? Cached : never;\n")
				w.p.cacheWitnesses[local] = true
			}
		}
		saved := w.runtimeText
		w.runtimeText = false
		checking := "("
		if !readsName(body, name.Text()) {
			checking = "(void " + w.patternText(subject, env{}) + ", "
		}
		checking += w.patternText(body, env{}) + ")"
		w.runtimeText = true
		runtimeBody := w.patternText(arrow.Body(), env{})
		runtimeSubject := w.patternText(subject, env{})
		w.runtimeText = saved
		runtime := "((" + w.identifier(name) + ") => " + runtimeBody + ")(" + runtimeSubject + ")"
		w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{checking, runtime}})
		return true
	}
	checking := "("
	if !readsName(body, name.Text()) {
		checking = "(void " + w.patternText(subject, env{}) + ", "
	}
	opening, closing := "(("+w.identifier(name)+") => ", ")("+w.patternText(subject, env{})+")"
	if ast.IsBlock(arrow.Body()) {
		opening += "{ " + w.patternText(arrow.Body().Statements()[0], env{}) + "return "
		closing = "; }" + closing
	}
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{checking, opening}})
	w.node(body, env{})
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{")", closing}})
	return true
}

// captureRead prints n when it reads a capture of a subject that is an
// identifier expression, and reports whether it does: a copy of the subject
// when checking, the capture when the program runs.
func (w *printer) captureRead(n *ast.Node, e env) bool {
	subject := w.captures[n.Text()]
	if subject == nil || n.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{w.patternText(subject, e), w.identifier(n)}})
	return true
}

// readsName reports whether node reads name, a capture's name the parser
// wrote, anywhere in it.
func readsName(node *ast.Node, name string) bool {
	if ast.IsIdentifier(node) {
		return node.Flags&ast.NodeFlagsReparsed != 0 && node.Text() == name
	}
	return node.ForEachChild(func(child *ast.Node) bool { return readsName(child, name) })
}

// capture records that name captures subject in this form.
func (w *printer) capture(name, subject *ast.Node) {
	if w.captures == nil {
		w.captures = map[string]*ast.Node{}
	}
	w.captures[name.Text()] = subject
}

// isCapture reports whether name is a capture's name the parser wrote: $match
// or $is and a number.
func isCapture(name *ast.Node) bool {
	if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	for _, prefix := range []string{"$match", "$is"} {
		if digits, ok := strings.CutPrefix(name.Text(), prefix); ok && digits != "" && strings.Trim(digits, "0123456789") == "" {
			return true
		}
	}
	return false
}

// isIdentifierExpression reports whether node is a name or this followed by
// property accesses and element accesses whose arguments are literals.
func isIdentifierExpression(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindIdentifier, ast.KindThisKeyword:
		return true
	case ast.KindPropertyAccessExpression:
		return ast.IsIdentifier(node.Name()) && isIdentifierExpression(node.Expression())
	case ast.KindElementAccessExpression:
		switch node.AsElementAccessExpression().ArgumentExpression.Kind {
		case ast.KindStringLiteral, ast.KindNumericLiteral:
			return isIdentifierExpression(node.Expression())
		}
	}
	return false
}
