package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
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
const ()

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
