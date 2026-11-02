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
	tryLabel     = "try"
	effectLabel  = "effect"
	untriedLabel = "try removed"
)

// tryEdits returns the edits that write try before each call of file that
// ran where it stood, and rewrite each call of an Effect value
// (effectValueCallEdits), with the calls the legacy model can't decide.
// Calls that start at one offset, as f() and f().g() do, get one edit
// there, the outer call's try first: try (try f()).g().
func tryEdits(c *checker.Checker, file *ast.SourceFile, unmatched map[int]bool) ([]sourceEdit, []tryRefusal) {
	a := analyzerFor(c)
	text := file.Text()
	var edits []sourceEdit
	var refusals []tryRefusal
	m := newLegacyModel(a, unmatched)
	opens := map[int]int{} // offset -> index in edits
	insert := func(at int, s string) {
		if i, ok := opens[at]; ok {
			edits[i].text += s
			return
		}
		opens[at] = len(edits)
		edits = append(edits, sourceEdit{at, at, s})
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if at, open, rest, ok := effectValueCallEdits(a, file, node); ok {
			if open != "" {
				insert(at, open)
			}
			edits = append(edits, rest...)
			// A call that gives the Effect value, as pick(flag) in
			// (pick(flag))(), is what that try runs: it gets none of its own.
			if inner := ast.SkipParentheses(node.Expression()); isInvocation(inner) {
				return inner.ForEachChild(visit)
			}
			return node.ForEachChild(visit)
		}
		if m.byNameBlock(node) {
			edits = append(edits, sourceEdit{scanner.SkipTrivia(text, node.Pos()), node.End(), m.blockText(file, node)})
			return false
		}
		if head := m.catchHeadRuns(node); head != nil {
			// The head becomes the program it was, with try before each call
			// that ran in it; one edit also opens the catch's own effect
			// block, which applyEdits could not order beside it.
			open := ""
			wrap := m.plainCatch(node) || m.heldCatch(node)
			if wrap {
				open = "effect { return "
			}
			edits = append(edits, sourceEdit{scanner.SkipTrivia(text, head.Pos()), head.End(), open + "(" + m.blockText(file, head) + ")"})
			if wrap {
				edits = append(edits, sourceEdit{node.End(), node.End(), " }"})
			}
			visit(node.Arguments()[1])
			return false
		}
		if m.plainCatch(node) || m.heldCatch(node) {
			insert(scanner.SkipTrivia(text, node.Pos()), "effect { return ")
			edits = append(edits, sourceEdit{node.End(), node.End(), " }"})
		}
		if isFunctionBoundary(node) && m.marked(node) {
			if legacyProgramLiteral(a, node) {
				edits = append(edits, programLiteralEdits(file, node)...)
			} else {
				edit, _, _ := effectMarkerEdit(file, node)
				insert(edit.start, edit.text)
			}
		}
		if !isInvocation(node) {
			return node.ForEachChild(visit)
		}
		if m.wrapperTry(node) {
			at := scanner.SkipTrivia(text, node.Pos())
			edits = append(edits, sourceEdit{at, scanner.SkipTrivia(text, at+len("try")), ""})
			return node.ForEachChild(visit)
		}
		write, reason := triesHere(m, file, node)
		if reason != "" {
			refusals = append(refusals, tryRefusal{scanner.SkipTrivia(text, node.Pos()), reason})
		}
		if write {
			start := scanner.SkipTrivia(text, node.Pos())
			if tryNeedsParentheses(node) {
				open := "(try "
				if continuesStatement(text, node, start) {
					open = ";(try "
				}
				insert(start, open)
				edits = append(edits, sourceEdit{node.End(), node.End(), ")"})
			} else {
				insert(start, "try ")
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return edits, refusals
}

// tryRefusal is a call where the legacy model can't tell whether it ran: its
// offset, and why.
type tryRefusal struct {
	at     int
	reason string
}

// triesHere reports whether --fix-vip-only writes try before call: a call
// written in the source, without try, that ran where it stood before VIP-1
// (legacyModel). When the legacy model can't tell, it reports why instead.
func triesHere(m *legacyModel, file *ast.SourceFile, call *ast.Node) (bool, string) {
	if call.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang|ast.NodeFlagsVibeLangTry) != 0 || isTryCall(call) || tried(call) || !triesSyntax(m.a, file, call) {
		return false, ""
	}
	switch run, reason := m.runOf(call); run {
	case legacyRan:
		return true, ""
	case legacyUnknown:
		return false, reason
	}
	return false, ""
}

// triesSyntax reports whether try can stand before call as written: not a
// form the parser writes as a call, fork(x), or a link an optional chain
// continues.
func triesSyntax(a *analyzer, file *ast.SourceFile, call *ast.Node) bool {
	if ast.IsCallExpression(call) {
		callee := call.Expression()
		if callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 || fiberHelper(call) != "" || catchExpressionOf(call) != nil || isInvokedForm(file, call) {
			return false // a form the parser writes as a call
		}
		if scanner.SkipTrivia(file.Text(), call.Pos()) != scanner.SkipTrivia(file.Text(), callee.Pos()) {
			return false // the call's text does not start with its callee
		}
	}
	if ast.IsCallExpression(call) && isRuntimeExport(a.checker, ast.SkipParentheses(call.Expression()), "fork") {
		return false // fork(x) is the keyword form fork x
	}
	if parent := call.Parent; parent != nil && ast.IsOptionalChain(parent) && parent.Expression() == call && ast.IsOptionalChain(call) {
		return false // a?.f().g(): parentheses would end the chain
	}
	return true
}

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

// tryRewriteProject returns the try edits of each of program's .vibe files
// that has any, and the calls of each that the legacy model can't decide.
func tryRewriteProject(ctx context.Context, program *compiler.Program) (map[tspath.RootedFilePath][]sourceEdit, map[tspath.RootedFilePath][]tryRefusal) {
	rewrites := map[tspath.RootedFilePath][]sourceEdit{}
	refusals := map[tspath.RootedFilePath][]tryRefusal{}
	for _, file := range fixableFiles(program) {
		unmatched := map[int]bool{}
		for _, d := range program.GetSemanticDiagnostics(ctx, file) {
			if d.Code() == 2769 && d.File() == file {
				unmatched[d.Pos()] = true
			}
		}
		c, done := program.GetTypeCheckerForFile(ctx, file)
		edits, refused := tryEdits(c, file, unmatched)
		done()
		if len(edits) > 0 {
			rewrites[file.FileName()] = edits
		}
		if len(refused) > 0 {
			refusals[file.FileName()] = refused
		}
	}
	return rewrites, refusals
}

// rewriteTries writes try before the calls of program's files that ran
// before VIP-1 (tryEdits) where that adds no error to program's: in every
// file when they pass together, else in each file that passes on its own. An
// error whose message quotes a call with try, try f(), is the error that
// quoted f(). It records them in result and texts, and reports each call the
// legacy model can't decide, and each file whose tries would add an error,
// as refused: such a file keeps calls that no longer run.
func rewriteTries(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) (wrote bool, refused []FixRefusal) {
	rewrites, refusals := tryRewriteProject(g.ctx, program)
	var refusing []tspath.RootedFilePath
	for name := range refusals {
		refusing = append(refusing, name)
	}
	slices.SortFunc(refusing, tspath.RootedFilePath.Compare)
	for _, name := range refusing {
		file := program.GetSourceFile(name)
		for _, r := range refusals[name] {
			line, _ := scanner.GetECMALineAndUTF16CharacterOfPosition(file, r.at)
			refused = append(refused, FixRefusal{File: name, Line: line + 1, Rewrite: tryLabel, Error: r.reason})
		}
	}
	if len(rewrites) == 0 {
		return false, refused
	}
	base := tryless(errorCounts(g.ctx, program))
	// added returns the first error overlay adds to program's, or "".
	added := func(overlay map[tspath.RootedFilePath]string) string {
		var first string
		for key, n := range tryless(errorCounts(g.ctx, g.build(maps(texts, overlay)))) {
			if n > base[key] && (first == "" || key < first) {
				first = key
			}
		}
		return first
	}
	candidates := map[tspath.RootedFilePath]string{}
	var names []tspath.RootedFilePath
	for name, edits := range rewrites {
		candidates[name] = applyEdits(program.GetSourceFile(name).Text(), edits)
		names = append(names, name)
	}
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	kept := map[tspath.RootedFilePath]string{}
	if added(candidates) == "" {
		kept = candidates
	} else {
		for _, name := range names {
			if g.done.Err() != nil {
				return false, refused
			}
			trial := maps(kept, map[tspath.RootedFilePath]string{name: candidates[name]})
			if why := added(trial); why == "" {
				kept = trial
			} else {
				line, _ := scanner.GetECMALineAndUTF16CharacterOfPosition(program.GetSourceFile(name), rewrites[name][0].start)
				refused = append(refused, FixRefusal{File: name, Line: line + 1, Rewrite: tryLabel, Error: "the file's tries would add " + why})
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
		for _, e := range rewrites[name] {
			fixed.Rewrites[tryLabel] += strings.Count(e.text, "try ")
			fixed.Rewrites[effectLabel] += strings.Count(e.text, "effect ")
			if e.text == "" && e.end > e.start {
				fixed.Rewrites[untriedLabel]++
			}
		}
		fixed.Text = text
		texts[name] = text
		wrote = true
	}
	return wrote, refused
}

// tryless returns counts with try removed from each error's key.
func tryless(counts map[string]int) map[string]int {
	result := make(map[string]int, len(counts))
	for key, n := range counts {
		result[strings.ReplaceAll(key, "try ", "")] += n
	}
	return result
}
