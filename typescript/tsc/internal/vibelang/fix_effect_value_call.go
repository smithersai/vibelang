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

// effectValueCallEdits retains the four-result protocol used by existing
// service-tag migrations. Only receipt-producing clients need the label.
func effectValueCallEdits(a *analyzer, file *ast.SourceFile, call *ast.Node) (at int, open string, edits []sourceEdit, ok bool) {
	at, open, edits, _, ok = effectValueCallEditsLabeled(a, file, call)
	return at, open, edits, ok
}

// effectValueCallEditsLabeled also attributes the rewrite in --fix receipts.
func effectValueCallEditsLabeled(a *analyzer, file *ast.SourceFile, call *ast.Node) (at int, open string, edits []sourceEdit, label string, ok bool) {
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 0 || call.TypeArguments() != nil || call.QuestionDotToken() != nil {
		return 0, "", nil, "", false
	}
	if call.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) != 0 {
		return 0, "", nil, "", false
	}
	fn := enclosingFunction(call)
	// The parser's catch-left function holds the Effect for catch to run.
	// It is plain until something inside it runs with try, so checking only
	// a.isEffect(fn) misses Port() as the complete catch head (foldkit MCP).
	catchHead := fn != nil && isCatchLeftFunction(fn) && inEffectCode(fn) && ast.SkipParentheses(fn.Body()) == call
	if !catchHead && (!inLowerableBody(call) || fn == nil || !a.isEffect(fn)) {
		return 0, "", nil, "", false
	}
	c := a.checker
	callee := call.Expression()
	t := c.GetApparentType(c.GetTypeAtLocation(callee))
	if len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) != 0 {
		return 0, "", nil, "", false
	}
	text := file.Text()
	start := scanner.SkipTrivia(text, call.Pos())
	tried := underTry(call)
	parens := !catchHead && !tried && tryNeedsParentheses(call)
	if ast.IsPropertyAccessExpression(callee) && !ast.IsPrivateIdentifier(callee.Name()) {
		receiver := callee.Expression()
		if identifier, _ := serviceMember(c, callee, c.GetApparentType(c.GetTypeAtLocation(receiver))); identifier != nil {
			// S.m(), where the service's member m is an Effect: (try S).m.
			if effectOfValue(c, t) == nil {
				return 0, "", nil, "", false
			}
			key := ""
			if name := moduleServiceKeyName(c, receiver); name != "" {
				key = "." + name
			}
			open, end := "(try ", ""
			switch {
			case catchHead || tried:
			case parens:
				open, end = "((try ", ")"
				if continuesStatement(text, call, start) {
					open = ";" + open
				}
			default:
				open = "try (try "
			}
			return scanner.SkipTrivia(text, receiver.Pos()), open, []sourceEdit{{receiver.End(), receiver.End(), key + ")"}, {callee.End(), call.End(), end}}, "", true
		}
	}
	key := moduleServiceKeyName(c, callee)
	if effectOfValue(c, t) == nil && key == "" {
		return 0, "", nil, "", false
	}
	end := ""
	if key != "" {
		end = "." + key
	}
	if catchHead {
		// Do not run the value before catch. Parentheses keep the operand
		// together, including a factory call or a module's service key.
		return start, "(", []sourceEdit{{callee.End(), call.End(), end + ")"}}, valueCallLabel, true
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
	return start, open, append(edits, sourceEdit{value.End(), call.End(), end}), "", true
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
