package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// An Effect is not a function, so calling one is TypeScript's TS2349, and
// only try runs it (VIP-5; VIP-10: get the service, then call it). Old
// VibeLang ran p(), for p an Effect value, where it stood: Users() gave the
// service (D501) and Port() read a Config (D24). vibelang --fix-vip-only
// keeps such a call's meaning in effect code: try p() becomes try p, and p()
// elsewhere becomes try p, or (try p) where a chain continues the value, as
// (try Users).find(id). A module that names its service (D311), FileSystem(),
// becomes try FileSystem.FileSystem, and a parenthesized callee loses its
// parentheses: try (pick(flag))() becomes try pick(flag). A service's
// member that is an Effect, called as S.m(), is read from the service, as
// VIP-10 writes it: try (try S).m.

// effectValueCallEdits returns the edits that rewrite call, when it is such a
// call in the body of an effect function: the text that try writes at
// offset at, and the other edits. It returns false for any other call.
func effectValueCallEdits(a *analyzer, file *ast.SourceFile, call *ast.Node) (at int, open string, edits []sourceEdit, ok bool) {
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 0 || call.TypeArguments() != nil || call.QuestionDotToken() != nil {
		return 0, "", nil, false
	}
	if call.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) != 0 || !inLowerableBody(call) {
		return 0, "", nil, false
	}
	if fn := enclosingFunction(call); fn == nil || !a.isEffect(fn) {
		return 0, "", nil, false
	}
	c := a.checker
	callee := call.Expression()
	t := c.GetApparentType(c.GetTypeAtLocation(callee))
	if len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) != 0 {
		return 0, "", nil, false
	}
	text := file.Text()
	start := scanner.SkipTrivia(text, call.Pos())
	tried := underTry(call)
	parens := !tried && tryNeedsParentheses(call)
	if ast.IsPropertyAccessExpression(callee) && !ast.IsPrivateIdentifier(callee.Name()) {
		receiver := callee.Expression()
		if identifier, _ := serviceMember(c, callee, c.GetApparentType(c.GetTypeAtLocation(receiver))); identifier != nil {
			// S.m(), where the service's member m is an Effect: (try S).m.
			if effectOfValue(c, t) == nil {
				return 0, "", nil, false
			}
			key := ""
			if name := moduleServiceKeyName(c, receiver); name != "" {
				key = "." + name
			}
			open, end := "(try ", ""
			switch {
			case tried:
			case parens:
				open, end = "((try ", ")"
				if continuesStatement(text, call, start) {
					open = ";" + open
				}
			default:
				open = "try (try "
			}
			return scanner.SkipTrivia(text, receiver.Pos()), open, []sourceEdit{{receiver.End(), receiver.End(), key + ")"}, {callee.End(), call.End(), end}}, true
		}
	}
	key := moduleServiceKeyName(c, callee)
	if effectOfValue(c, t) == nil && key == "" {
		return 0, "", nil, false
	}
	end := ""
	if key != "" {
		end = "." + key
	}
	value := callee
	if ast.IsParenthesizedExpression(callee) && !parens {
		value = ast.SkipParentheses(callee)
		inner := scanner.SkipTrivia(text, value.Pos())
		edits = append(edits, sourceEdit{scanner.SkipTrivia(text, callee.Pos()), inner, ""})
	}
	switch {
	case tried:
	case parens:
		open = "(try "
		if continuesStatement(text, call, start) {
			open = ";(try "
		}
		end += ")"
	default:
		open = "try "
	}
	return start, open, append(edits, sourceEdit{value.End(), call.End(), end}), true
}

// underTry reports whether node, parentheses aside, is the operand of try,
// which the parser marks with NodeFlagsVibeLangTry.
func underTry(node *ast.Node) bool {
	for n := node; ; n = n.Parent {
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 || tryOperand(n.Parent) == n {
			return true
		}
		if n.Parent == nil || !ast.IsParenthesizedExpression(n.Parent) {
			return false
		}
	}
}
