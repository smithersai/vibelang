package checker

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// isVibeLangWrittenDeclaration reports whether declaration declares a name
// that the VibeLang parser writes in a .vibe file, such as the const $match1
// that holds a match's subject (parser/vibelang_match.go): a synthesized
// identifier that starts with $. People neither write nor read such a name,
// so it is never reported unused.
func isVibeLangWrittenDeclaration(declaration *ast.Node) bool {
	name := declaration.Name()
	return name != nil && ast.IsIdentifier(name) && name.Flags&ast.NodeFlagsReparsed != 0 && strings.HasPrefix(name.Text(), "$") &&
		ast.GetSourceFileOfNode(declaration).FileName().ExtensionIs(tspath.ExtensionVibe)
}

// isVibeLangServiceDeclaredMember reports whether member of class, a service
// declaration of a .vibe file, is its key or default (VIP-9). The declaration
// declares them; only the base the parser writes holds them too, so they
// override nothing the source wrote.
func isVibeLangServiceDeclaredMember(class *ast.Node, member *ast.Symbol) bool {
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil || !ast.GetSourceFileOfNode(class).FileName().ExtensionIs(tspath.ExtensionVibe) {
		return false
	}
	base := extends.Expression()
	if !ast.IsIdentifier(base) || base.Flags&ast.NodeFlagsReparsed == 0 || base.Text() != parser.ServiceShapeFactory {
		return false
	}
	name := ast.SymbolName(member)
	return name == "key" || name == "defaultValue"
}

// isVibeLangClassPattern reports whether call is the test the parser writes
// for a class pattern of a .vibe file, `when NotFound:` or `e is NotFound`
// (parser/vibelang_match.go): a call of the runtime's $is whose matcher is a
// class. $is tests a class with instanceof, or with its custom matcher, which
// for an error class is instanceof too (D213, D215, D278). The call narrows
// as instanceof does, by derivation rather than by shape, so two classes with
// the same name and fields, or a family's base and an unrelated error with
// the same fields, stay distinct, and D209's proof sees the cases a class
// pattern leaves (vibelang/match.go).
func (c *Checker) isVibeLangClassPattern(call *ast.Node) bool {
	callee := call.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 || callee.Text() != "$is" {
		return false
	}
	args := call.Arguments()
	if len(args) != 2 {
		return false
	}
	patterns := c.ExtensionState(classPatternsKey{}, func() any { return map[*ast.Node]bool{} }).(map[*ast.Node]bool)
	if isClass, ok := patterns[call]; ok {
		return isClass
	}
	isClass := len(c.getSignaturesOfType(c.getTypeOfExpression(args[0]), SignatureKindConstruct)) != 0
	if c.typesAreSettled() {
		patterns[call] = isClass
	}
	return isClass
}

type (
	classPatternsKey struct{}
	matcherTypesKey  struct{}
)

// TypeOfPatternMatcher returns GetTypeAtLocation(matcher), where matcher is
// an expression the parser passes a pattern's $is or $extract call, such as
// Big.V0, and remembers it for the node. Flow analysis narrows each
// reference to a match's subject through every arm before it, and asks for
// each arm's matcher on the way. A matcher is itself a reference, so its
// type walks back through those arms too. Without the cache, a match of n
// arms costs n^3. Inside a loop's analysis types may be transient, as
// checkExpressionCached notes, so answers given there are not remembered.
func (c *Checker) TypeOfPatternMatcher(matcher *ast.Node) *Type {
	types := c.ExtensionState(matcherTypesKey{}, func() any { return map[*ast.Node]*Type{} }).(map[*ast.Node]*Type)
	if t := types[matcher]; t != nil {
		return t
	}
	t := c.GetTypeAtLocation(matcher)
	if c.typesAreSettled() {
		types[matcher] = t
	}
	return t
}

// typesAreSettled reports whether the types the checker computes now are
// final: flow analysis is not inside a loop, where a reference's type may be
// a transient step toward its fixed point.
func (c *Checker) typesAreSettled() bool {
	return len(c.flowLoopStack) == 0
}
