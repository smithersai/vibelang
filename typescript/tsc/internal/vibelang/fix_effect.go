package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// vibelang --fix-vip-only writes the VIP-1 and VIP-2 syntax for what the
// analyzer decides today, so each function keeps its meaning when the
// syntax alone decides (VIP-1: "a keyword on the function, never its body,
// decides its kind"):
//
//	function load(id) { return try find(id) }     effect function load(id) { return try find(id) }
//	forEach(ids, (id) => find(id))                 forEach(ids, effect (id) => try find(id))
//	retry(() => { try save(x) }, policy)           retry(effect { try save(x) }, policy)
//	retry(() => save(x), policy)                   retry(effect { return try save(x) }, policy)
//
// It marks effect each function the analyzer compiles to an Effect: every
// method and function declaration whose form is Effect, except a function
// declaration that compiles to plain JavaScript (D421), and every function
// literal in the Effect form. A literal in the program form, a function
// literal with no parameters converted where an Effect is expected (D551,
// D480), becomes an effect block. A value such a function returns that
// the function runs, a returned program, gets try, as does a literal's body
// that is a call the analyzer runs. A plain function's calls lose the try
// that slice 1 wrote where its Effect form ran: the function is plain
// JavaScript now, and its call gives the value.

// effectLabel is the kind of rewrite, as the --fix report names it.
const effectLabel = "effect"

// effectEdits returns the edits that write effect where file's functions
// compile to Effects, and the number of functions marked.
func effectEdits(c *checker.Checker, file *ast.SourceFile) ([]sourceEdit, int) {
	return analyzerFor(c).effectEditsIn(file, file.AsNode())
}

// effectEditsIn returns the effect edits of the nodes under node.
func (a *analyzer) effectEditsIn(file *ast.SourceFile, node *ast.Node) ([]sourceEdit, int) {
	text := file.Text()
	var edits []sourceEdit
	marked := 0
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsCallExpression(node) && node.Flags&(ast.NodeFlagsVibeLangTry|ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) == 0 && !tried(node) && a.directToMarked(node):
			edits = append(edits, tryEditsAt(file, node)...)
		case node.Flags&ast.NodeFlagsVibeLangTry != 0 && isInvocation(node):
			if callee := a.plainCallee(node); callee != nil {
				keyword := tryKeyword(file, node)
				end := keyword.End()
				for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
					end++
				}
				edits = append(edits, sourceEdit{keyword.Pos(), end, ""})
			}
		case ast.IsFunctionLike(node) && node.Body() != nil && !isMarkedEffect(node) && isLowerable(node) && !isProducer(node) && !isProgramArrow(node):
			switch a.effectRewriteOf(node) {
			case formEffect:
				edits = append(edits, sourceEdit{effectPosition(file, node), effectPosition(file, node), "effect "})
				edits = append(edits, a.returnTries(file, node)...)
				marked++
			case formProgram:
				if body := node.Body(); !ast.IsBlock(body) {
					// The block's text is the body's, with the edits inside it.
					inner, n := a.effectEditsIn(file, body)
					edits = append(edits, a.effectBlockEdits(file, node, inner)...)
					marked += n + 1
					return false
				}
				edits = append(edits, a.effectBlockEdits(file, node, nil)...)
				marked++
			}
		}
		return node.ForEachChild(visit)
	}
	node.ForEachChild(visit)
	return edits, marked
}

// effectRewriteOf is the form fn's rewrite writes: formEffect to mark it
// effect, formProgram to write it as an effect block, formNone to keep it.
func (a *analyzer) effectRewriteOf(fn *ast.Node) form {
	if a.isFactory(fn) || isForkOperand(fn) {
		return formNone // D269: a plain body that returns a program; fork's operand is VIP-17's
	}
	if t := fn.Type(); t != nil && a.isEffectAnnotation(t) && !isLambda(fn) {
		return formEffect // an Effect contract: an Effect function, its $direct variant aside
	}
	if isPlainCandidate(fn) && a.isPlainFunction(fn) {
		return formNone // D421: plain JavaScript, called through its $direct variant
	}
	if isCatchHandler(fn) {
		// x catch (e) => y: the handler's syntax decides (VIP-5); it is an
		// effect function only when it runs an Effect or throws.
		if a.firstPause(fn) != nil || hasEscapingThrow(fn) {
			return formEffect
		}
		return formNone
	}
	if isLambda(fn) {
		switch a.finalForm(fn) {
		case formEffect:
			return formEffect
		case formProgram:
			if len(fn.Parameters()) == 0 && fn.Type() == nil {
				return formProgram
			}
			return formNone // an annotated literal converted where an Effect is expected: no block keeps its annotation
		}
		return formNone
	}
	if isWrittenForm(fn) && a.isEffect(fn) {
		return formEffect
	}
	return formNone
}

// isForkOperand reports whether fn, parentheses aside, is the operand of
// fork.
func isForkOperand(fn *ast.Node) bool {
	n := fn
	for n.Parent != nil && (ast.IsParenthesizedExpression(n.Parent) || isProgramArrow(n.Parent) && n.Parent.Body() == n) {
		n = n.Parent
	}
	call := n.Parent
	if call == nil || !ast.IsCallExpression(call) {
		return false
	}
	callee := ast.SkipParentheses(call.Expression())
	return fiberHelper(call) != "" || ast.IsIdentifier(callee) && callee.Text() == "fork" // fork(x), the keyword form written as a call
}

// directToMarked reports whether call, in the body of a function the
// rewrite leaves an Effect function, calls through its $direct variant
// (D421) a function the rewrite marks effect: the call gives a value today,
// and gives the Effect once effect decides, so it gets try.
func (a *analyzer) directToMarked(call *ast.Node) bool {
	signature := a.checker.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	callee := implementationOf(signature.Declaration())
	if callee == nil || !isLowerable(callee) || !isPlainCandidate(callee) || !a.isPlainFunction(callee) || a.effectRewriteOf(callee) != formEffect {
		return false
	}
	if a.directReferenceOf(ast.GetInvokedExpression(call), callee) == nil || a.byNameOf(call) != nil {
		return false
	}
	fn := enclosingFunction(call)
	return fn != nil && inLowerableBody(call) && (isMarkedEffect(fn) || a.effectRewriteOf(fn) != formNone)
}

// tryEditsAt writes try before call, with parentheses where a chain
// continues it.
func tryEditsAt(file *ast.SourceFile, call *ast.Node) []sourceEdit {
	start := scanner.SkipTrivia(file.Text(), call.Pos())
	if tryNeedsParentheses(call) {
		return []sourceEdit{{start, start, "(try "}, {call.End(), call.End(), ")"}}
	}
	return []sourceEdit{{start, start, "try "}}
}

// isCatchHandler reports whether fn is the handler of x catch handler.
func isCatchHandler(fn *ast.Node) bool {
	call := fn.Parent
	return call != nil && catchExpressionOf(call) != nil && len(call.Arguments()) > 1 && call.Arguments()[0] != fn && slices.Contains(call.Arguments(), fn)
}

// plainCallee returns the function call calls when that function compiles
// to plain JavaScript (D421) and stays unmarked, or nil.
func (a *analyzer) plainCallee(call *ast.Node) *ast.Node {
	if !ast.IsCallExpression(call) {
		return nil
	}
	signature := a.checker.GetResolvedSignature(call)
	if signature == nil {
		return nil
	}
	fn := implementationOf(signature.Declaration())
	if fn == nil || isMarkedEffect(fn) || !isLowerable(fn) || !isPlainCandidate(fn) || a.effectRewriteOf(fn) != formNone {
		return nil
	}
	return fn
}

// effectPosition is where effect goes before fn: before function, before a
// method's name, or at an arrow's start, after the modifiers in each case.
func effectPosition(file *ast.SourceFile, fn *ast.Node) int {
	text := file.Text()
	start := scanner.SkipTrivia(text, fn.Pos())
	if modifiers := fn.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
		start = scanner.SkipTrivia(text, modifiers.Nodes[len(modifiers.Nodes)-1].End())
	}
	return start
}

// returnTries returns the edits that write try before each value fn returns
// that the analyzer runs: a returned program, or an arrow's body that is a
// call it runs.
func (a *analyzer) returnTries(file *ast.SourceFile, fn *ast.Node) []sourceEdit {
	var edits []sourceEdit
	add := func(expr *ast.Node) {
		if expr == nil || a.runsReturned(expr) == false {
			return
		}
		edits = append(edits, tryEditsAround(file, expr)...)
	}
	if body := fn.Body(); body != nil && !ast.IsBlock(body) {
		add(body)
		return edits
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsReturnStatement(node) {
			add(node.Expression())
		}
		return node.ForEachChild(visit)
	}
	fn.Body().ForEachChild(visit)
	return edits
}

// runsReturned reports whether expr, a value an Effect function returns,
// runs there: a returned program, or a call the analyzer runs that has no
// try.
func (a *analyzer) runsReturned(expr *ast.Node) bool {
	inner := ast.SkipParentheses(expr)
	if inner.Flags&(ast.NodeFlagsVibeLangTry|ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) != 0 || isTryCall(inner) {
		return false
	}
	if isInvocation(inner) && ast.IsCallExpression(inner) {
		if callee := inner.Expression(); callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 || fiberHelper(inner) != "" {
			return false // a form the parser writes as a call: match, catch, throw, join, …
		}
		if isInvokedForm(ast.GetSourceFileOfNode(inner), inner) {
			return false
		}
	}
	if isInvocation(inner) && a.byNameOf(inner) != nil {
		return false // passed by name, not run
	}
	if isInvocation(inner) && a.performs(inner) {
		return true
	}
	if isInvocation(inner) {
		// A returned subtype, such as an Exit, runs as a program today
		// (S5-1); try runs only an Effect, so it stays as written.
		if sig := a.checker.GetResolvedSignature(inner); sig == nil || !isEffectType(a.checker, a.checker.GetReturnTypeOfSignature(sig)) {
			return false
		}
	}
	if ast.IsIdentifier(inner) || ast.IsPropertyAccessExpression(inner) {
		if symbol := a.checker.GetSymbolAtLocation(inner); symbol == nil || !isEffectType(a.checker, a.checker.GetTypeOfSymbol(symbol)) {
			return false
		}
	}
	return a.returnedProgram(expr) != nil
}

// tryEditsAround writes try before expr, with parentheses around expr
// unless it is a unary operand already.
func tryEditsAround(file *ast.SourceFile, expr *ast.Node) []sourceEdit {
	start := scanner.SkipTrivia(file.Text(), expr.Pos())
	if isUnaryOperand(expr) {
		return []sourceEdit{{start, start, "try "}}
	}
	return []sourceEdit{{start, start, "try ("}, {expr.End(), expr.End(), ")"}}
}

// isUnaryOperand reports whether expr parses as the operand of a prefix
// operator as written.
func isUnaryOperand(expr *ast.Node) bool {
	switch expr.Kind {
	case ast.KindCallExpression, ast.KindNewExpression, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression,
		ast.KindIdentifier, ast.KindParenthesizedExpression, ast.KindTaggedTemplateExpression, ast.KindThisKeyword,
		ast.KindArrayLiteralExpression, ast.KindObjectLiteralExpression, ast.KindNonNullExpression:
		return expr.Flags&ast.NodeFlagsReparsed == 0
	}
	return false
}

// effectBlockEdits rewrites fn, a function literal with no parameters in
// the program form, as an effect block: () => { … } as effect { … }, and
// () => x as effect { return x }, with try before x when the program runs
// it. inner are the edits inside an expression body x.
func (a *analyzer) effectBlockEdits(file *ast.SourceFile, fn *ast.Node, inner []sourceEdit) []sourceEdit {
	text := file.Text()
	start := scanner.SkipTrivia(text, fn.Pos())
	body := fn.Body()
	if ast.IsBlock(body) {
		open := scanner.SkipTrivia(text, body.Pos())
		edits := []sourceEdit{{start, open, "effect "}}
		return append(edits, a.returnTries(file, fn)...)
	}
	from := scanner.SkipTrivia(text, body.Pos())
	shifted := make([]sourceEdit, len(inner))
	for i, e := range inner {
		shifted[i] = sourceEdit{e.start - from, e.end - from, e.text}
	}
	value := applyEdits(text[from:body.End()], mergeInsertions(shifted))
	if inner := ast.SkipParentheses(body); ast.IsObjectLiteralExpression(inner) && !ast.IsParenthesizedExpression(body) {
		value = "(" + value + ")"
	}
	if a.runsReturned(body) {
		if isUnaryOperand(body) {
			value = "try " + value
		} else {
			value = "try (" + value + ")"
		}
	}
	return []sourceEdit{{start, body.End(), "effect { return " + value + " }"}}
}

// effectRewriteProject returns the effect edits of each of program's .vibe
// files that has any, with the number of functions each marks.
func effectRewriteProject(ctx context.Context, program *compiler.Program) (map[tspath.RootedFilePath][]sourceEdit, map[tspath.RootedFilePath]int) {
	rewrites := map[tspath.RootedFilePath][]sourceEdit{}
	counts := map[tspath.RootedFilePath]int{}
	for _, file := range fixableFiles(program) {
		program.GetSemanticDiagnostics(ctx, file)
		c, done := program.GetTypeCheckerForFile(ctx, file)
		edits, marked := effectEdits(c, file)
		done()
		if len(edits) > 0 {
			rewrites[file.FileName()] = mergeInsertions(edits)
			counts[file.FileName()] = marked
		}
	}
	return rewrites, counts
}

// mergeInsertions joins insertions at one offset into one edit, in the order
// they were made, so applyEdits sees no two edits at one place.
func mergeInsertions(edits []sourceEdit) []sourceEdit {
	var merged []sourceEdit
	at := map[int]int{}
	for _, e := range edits {
		if e.start == e.end {
			if i, ok := at[e.start]; ok {
				merged[i].text += e.text
				continue
			}
			at[e.start] = len(merged)
		}
		merged = append(merged, e)
	}
	slices.SortStableFunc(merged, func(x, y sourceEdit) int {
		if x.start != y.start {
			return x.start - y.start
		}
		return (x.end - x.start) - (y.end - y.start)
	})
	return merged
}

// rewriteEffects writes the effect edits of program's files where they add
// no error, as rewriteTries does, and records them in result and texts.
func rewriteEffects(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	rewrites, counts := effectRewriteProject(g.ctx, program)
	if len(rewrites) == 0 {
		return
	}
	base := effectless(errorCounts(g.ctx, program))
	firstAdded := ""
	passes := func(overlay map[tspath.RootedFilePath]string) bool {
		var added []string
		for key, n := range effectless(errorCounts(g.ctx, g.build(maps(texts, overlay)))) {
			if n > base[key] {
				added = append(added, key)
			}
		}
		slices.Sort(added)
		if len(added) > 0 {
			firstAdded = added[0]
		}
		return len(added) == 0
	}
	candidates := map[tspath.RootedFilePath]string{}
	var names []tspath.RootedFilePath
	for name, edits := range rewrites {
		candidates[name] = applyEdits(program.GetSourceFile(name).Text(), edits)
		names = append(names, name)
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	kept := map[tspath.RootedFilePath]string{}
	if passes(candidates) {
		kept = candidates
	} else {
		for _, name := range names {
			if g.done.Err() != nil {
				return
			}
			trial := maps(kept, map[tspath.RootedFilePath]string{name: candidates[name]})
			if passes(trial) {
				kept = trial
			} else {
				result.Refused = append(result.Refused, FixRefusal{File: name, Error: firstAdded})
			}
		}
	}
	for _, name := range names {
		text, ok := kept[name]
		if !ok {
			continue
		}
		fixed := result.Files[name]
		if fixed == nil {
			original, _ := fs.ReadFile(name)
			fixed = &FixedFile{Original: original, Counts: map[int32]int{}}
			result.Files[name] = fixed
			result.Order = append(result.Order, name)
		}
		if fixed.Rewrites == nil {
			fixed.Rewrites = map[string]int{}
		}
		fixed.Rewrites[effectLabel] += counts[name]
		fixed.Text = text
		texts[name] = text
		if text == fixed.Original && len(fixed.Counts) == 0 {
			// The effect pass took back the try the try pass wrote before a
			// plain function's call: the file is as it was.
			delete(result.Files, name)
			result.Order = slices.DeleteFunc(result.Order, func(n tspath.RootedFilePath) bool { return n == name })
		}
	}
}

// effectless returns counts with try and effect removed from each error's
// key, so an error that quotes code the rewrite changed keeps its key.
func effectless(counts map[string]int) map[string]int {
	result := make(map[string]int, len(counts))
	for key, n := range counts {
		key = strings.ReplaceAll(key, "try ", "")
		key = strings.ReplaceAll(key, "effect ", "")
		result[key] += n
	}
	return result
}
