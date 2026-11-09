package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
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
