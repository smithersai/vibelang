package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Type text that reads right where it is written.
//
// The checker prints an Effect type by its declared name: Effect's FileSystem
// service type prints as FileSystem. In a .vibe file with the DOM lib loaded,
// the bare type name FileSystem is the DOM's (VIP-14: ambient types keep their
// meaning in type positions), so a diagnostic that says "needs FileSystem, but
// its contract says R = FileSystem" names two different types with one word,
// and a suggested contract FileSystem | FileSystem names the wrong one twice.
// typeTextAt writes such a member through its module, FileSystem.FileSystem,
// which names Effect's type wherever the module's name is in scope.

// typeTextAt writes t for code at location: c.TypeToString, except that a
// union member declared in effect whose bare name names another type at
// location is written through the Effect module that exports it.
func typeTextAt(c *checker.Checker, t *checker.Type, location *ast.Node) string {
	if t == nil || location == nil {
		return c.TypeToString(t)
	}
	members := unionMembers(t)
	texts := make([]string, len(members))
	qualified := false
	for i, member := range members {
		texts[i] = c.TypeToString(member)
		if text, ok := qualifiedEffectTypeText(c, member, texts[i], location); ok {
			texts[i] = text
			qualified = true
		}
	}
	if !qualified {
		return c.TypeToString(t)
	}
	return strings.Join(texts, " | ")
}

// shadowedEffectType returns the bare name of t, a type declared in effect,
// when that name names a different type at location and the Effect module of
// the same name, in scope there, exports t under it.
func shadowedEffectType(c *checker.Checker, t *checker.Type, location *ast.Node) (string, bool) {
	symbol := t.Symbol()
	if symbol == nil || !declaredInEffect(symbol) {
		return "", false
	}
	name := symbol.Name()
	bare := c.ResolveName(name, location, ast.SymbolFlagsType, false)
	if bare != nil && bare.Flags()&ast.SymbolFlagsAlias != 0 {
		bare = c.GetAliasedSymbol(bare)
	}
	if bare == nil || bare == symbol {
		return "", false
	}
	module := c.ResolveName(name, location, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false)
	if export := moduleAliasOf(c, module, name); export == nil || export != symbol {
		return "", false
	}
	return name, true
}

// qualifiedEffectTypeText writes text, member's own text, through its module
// when shadowedEffectType finds its bare name taken at location.
func qualifiedEffectTypeText(c *checker.Checker, member *checker.Type, text string, location *ast.Node) (string, bool) {
	name, ok := shadowedEffectType(c, member, location)
	if !ok || !(text == name || strings.HasPrefix(text, name+"<")) {
		return "", false
	}
	return name + "." + text, true
}

// ambientNamesake returns the member of declared, a channel type, that is
// not declared in effect but has the bare name of a member of extra, an
// Effect type that name does not reach at location, or nil: the DOM's
// FileSystem a contract wrote where the body needs Effect's FileSystem.
func ambientNamesake(c *checker.Checker, declared *checker.Type, extra *checker.Type, location *ast.Node) *checker.Type {
	if declared == nil {
		return nil
	}
	for _, wanted := range unionMembers(extra) {
		name, ok := shadowedEffectType(c, wanted, location)
		if !ok {
			continue
		}
		for _, member := range unionMembers(declared) {
			if symbol := member.Symbol(); symbol != nil && symbol.Name() == name && !declaredInEffect(symbol) {
				return member
			}
		}
	}
	return nil
}
