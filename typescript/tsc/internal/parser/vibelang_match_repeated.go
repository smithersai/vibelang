package parser

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Chapter 004 keeps the pinned duplicate-initialization rule inside one
// top-level pattern: a name may appear in several binding patterns with the
// same keyword, they share one cell, and running a second of them is a
// ReferenceError, except that a later alternative of an or may replace a cell
// that a failed earlier alternative of that or initialized. Two binding
// patterns in different alternatives of one or never both run without that
// failure, so only a name with two sites joined some other way (and, a list,
// an object) is checked, and every other pattern compiles as before.
//
// A checked name's flag is 0 while no binding pattern has run, 1 once one
// has, and an or's own number once a failed alternative of that or has
// initialized the cell. A binding pattern throws unless the flag is 0 or the
// number of an or it stands in a later alternative of.

// bindingKey names a binding pattern's cell: its name and its keyword.
func bindingKey(pat *pattern) string {
	return pat.name.Text() + "/" + strconv.Itoa(int(pat.bindFlags))
}

// conflictingBindings returns the keys of pat's names that two binding
// patterns can both initialize, ignoring var bindings (EK0107).
func conflictingBindings(pat *pattern) []string {
	sites := map[string][][]*pattern{}
	var order []string
	var stack []*pattern
	var visit func(*pattern)
	visit = func(pat *pattern) {
		if pat == nil {
			return
		}
		stack = append(stack, pat)
		if pat.kind == patternBinding && pat.name != nil && pat.bindFlags != ast.NodeFlagsNone {
			key := bindingKey(pat)
			if sites[key] == nil {
				order = append(order, key)
			}
			sites[key] = append(sites[key], append([]*pattern(nil), stack...))
		}
		for _, item := range pat.items {
			visit(item)
		}
		visit(pat.rest)
		for _, clause := range pat.clauses {
			visit(clause.pattern)
		}
		stack = stack[:len(stack)-1]
	}
	visit(pat)
	var keys []string
	for _, key := range order {
		paths := sites[key]
		conflict := false
		for i := 0; i < len(paths) && !conflict; i++ {
			for j := i + 1; j < len(paths) && !conflict; j++ {
				a, b := paths[i], paths[j]
				k := 0
				for k < len(a) && k < len(b) && a[k] == b[k] {
					k++
				}
				// a[k-1] is the nearest common ancestor; binding patterns in
				// two alternatives of one or never both run.
				conflict = a[k-1].kind != patternOr
			}
		}
		if conflict {
			keys = append(keys, key)
		}
	}
	return keys
}

// bindsKey reports whether pat holds a binding pattern for key.
func bindsKey(pat *pattern, key string) bool {
	if pat == nil {
		return false
	}
	if pat.kind == patternBinding && pat.name != nil && bindingKey(pat) == key {
		return true
	}
	for _, item := range pat.items {
		if bindsKey(item, key) {
			return true
		}
	}
	if bindsKey(pat.rest, key) {
		return true
	}
	for _, clause := range pat.clauses {
		if bindsKey(clause.pattern, key) {
			return true
		}
	}
	return false
}

// startCheckedBindings runs once per top-level pattern, at its first
// compilePattern: it records the checked names and clears their flags.
func (p *Parser) startCheckedBindings(pat *pattern, steps *[]matchStep, ctx *matchCompile) {
	ctx.checked = map[string]string{}
	ctx.checkedOrder = conflictingBindings(pat)
	ctx.orNumbers = new(int)
	*ctx.orNumbers = 1
	for _, key := range ctx.checkedOrder {
		p.vibelangMatchTemps++
		flag := "$bound" + strconv.Itoa(p.vibelangMatchTemps)
		ctx.checked[key] = flag
		*steps = append(*steps, matchStep{test: p.hoistDeclaration(p.numberTemp(flag, p.mNumber(0, pat.anchor), pat.anchor), pat.anchor)})
	}
	if len(ctx.checked) > 0 && ctx.bound == nil {
		ctx.bound = map[string]bool{}
	}
}

// checkedBinding writes a binding pattern of a checked name: it throws
// ReferenceError when the cell is initialized and no enclosing or permits
// the replacement, then assigns the shared cell and marks the flag 1.
func (p *Parser) checkedBinding(pat *pattern, path matchPath, flag string, ctx *matchCompile) *ast.Node {
	at := pat.anchor
	taken := p.mBinary(p.mTemp(flag, at), ast.KindExclamationEqualsEqualsToken, p.mNumber(0, at), at)
	for _, or := range ctx.laterIn {
		taken = p.mBinary(taken, ast.KindAmpersandAmpersandToken, p.mBinary(p.mTemp(flag, at), ast.KindExclamationEqualsEqualsToken, p.mNumber(or, at), at), at)
	}
	duplicate := p.mCall(p.vibelangIntrinsic("$duplicateBinding", at), []*ast.Node{p.mString(pat.name.Text(), at)}, at)
	check := p.mParens(p.mBinary(p.mParens(taken, at), ast.KindAmpersandAmpersandToken, duplicate, at), at)
	assign := p.inlineBinding(pat, path, ctx)
	live := p.mParens(p.mBinary(p.mTemp(flag, at), ast.KindEqualsToken, p.mNumber(1, at), at), at)
	return p.mParens(p.mBinary(p.mBinary(check, ast.KindCommaToken, assign, at), ast.KindCommaToken, live, at), at)
}

// checkedOrFlags returns the flags of the checked names pat binds.
func (p *Parser) checkedOrFlags(pat *pattern, ctx *matchCompile) []string {
	var flags []string
	for _, key := range ctx.checkedOrder {
		if bindsKey(pat, key) {
			flags = append(flags, ctx.checked[key])
		}
	}
	return flags
}

// compileCheckedOr writes an or that binds checked names. It saves their
// flags when the or starts. When an alternative but the last fails having
// changed a flag, the flag becomes the or's number, which the binding
// patterns of its later alternatives accept.
func (p *Parser) compileCheckedOr(pat *pattern, path matchPath, flags []string, ctx *matchCompile, at core.TextRange) *ast.Node {
	*ctx.orNumbers++
	number := *ctx.orNumbers
	var saved []string
	var tests []*ast.Node
	for _, flag := range flags {
		p.vibelangMatchTemps++
		name := "$saved" + strconv.Itoa(p.vibelangMatchTemps)
		saved = append(saved, name)
		tests = append(tests, p.hoistDeclaration(p.numberTemp(name, p.mTemp(flag, at), at), at))
	}
	outer := ctx.laterIn
	var alternatives []*ast.Node
	for i, item := range pat.items {
		if i > 0 {
			ctx.laterIn = append(outer[:len(outer):len(outer)], number)
		}
		alternative := p.mParens(p.inlinePattern(item, path, ctx), at)
		ctx.laterIn = outer
		if i < len(pat.items)-1 {
			failed := p.mKeyword(ast.KindFalseKeyword, at)
			for j := len(flags) - 1; j >= 0; j-- {
				changed := p.mBinary(p.mTemp(flags[j], at), ast.KindExclamationEqualsEqualsToken, p.mTemp(saved[j], at), at)
				mark := p.mParens(p.mBinary(p.mTemp(flags[j], at), ast.KindEqualsToken, p.mNumber(number, at), at), at)
				failed = p.mBinary(p.mParens(p.mBinary(changed, ast.KindAmpersandAmpersandToken, mark, at), at), ast.KindCommaToken, failed, at)
			}
			alternative = p.mParens(p.mBinary(alternative, ast.KindBarBarToken, p.mParens(failed, at), at), at)
		}
		alternatives = append(alternatives, alternative)
	}
	tests = append(tests, p.mParens(p.joinTests(alternatives, ast.KindBarBarToken, at), at))
	return p.joinTests(tests, ast.KindAmpersandAmpersandToken, at)
}

// numberTemp declares a flag the parser introduces, typed number: a flag
// assigned from another flag would otherwise infer its type circularly.
func (p *Parser) numberTemp(name string, init *ast.Node, at core.TextRange) *ast.Node {
	statement := p.mConst(p.mTemp(name, at), ast.NodeFlagsLet, init, at)
	declaration := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	declaration.AsVariableDeclaration().Type = p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindNumberKeyword), at)
	return statement
}
