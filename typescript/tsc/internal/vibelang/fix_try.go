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

// vibelang --fix writes try before each call that runs where it stands
// (VIP-5; runsWhereItStands in try.go): every call the analyzer performs, as
// an Effect, through an Effect function's direct variant, or as a service
// lookup, in the body of an Effect function, outside any expression passed
// by name. `try f()` means what f() means there, so the program keeps its
// meaning. It writes none where a call is passed or held unrun: an await
// operation's element, the operand of fork, a by-name argument, a held const
// or field, a hatch body, a module's top level, or a plain function; nor
// before fork(x), the keyword form fork x written as a call; nor before the
// left side of x catch y or a call in it, which the catch runs; nor in a function literal whose body
// is the call alone, () => f(), which returns the call's program. A call
// whose value a chain continues, as f() in f().name, is written
// (try f()).name; one that an optional chain continues, a?.f().g(), keeps
// its chain and gets no try.

// tryLabel is the kind of rewrite, as the --fix report names it.
const tryLabel = "try"

// tryEdits returns the edits that write try before each call of file that
// runs where it stands. Calls that start at one offset, as f() and f().g()
// do, get one edit there, the outer call's try first: try (try f()).g().
func tryEdits(c *checker.Checker, file *ast.SourceFile) []sourceEdit {
	a := analyzerFor(c)
	text := file.Text()
	var edits []sourceEdit
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
		if isInvocation(node) && triesHere(a, file, node) {
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
	return edits
}

// triesHere reports whether --fix writes try before call: a call written in
// the source, without try, that the analyzer runs in the body of an Effect
// function.
func triesHere(a *analyzer, file *ast.SourceFile, call *ast.Node) bool {
	if call.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang|ast.NodeFlagsVibeLangTry) != 0 || isTryCall(call) || tried(call) {
		return false
	}
	if ast.IsCallExpression(call) {
		callee := call.Expression()
		if callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 || fiberHelper(call) != "" || catchExpressionOf(call) != nil || isInvokedForm(file, call) {
			return false // a form the parser writes as a call
		}
		if scanner.SkipTrivia(file.Text(), call.Pos()) != scanner.SkipTrivia(file.Text(), callee.Pos()) {
			return false // the call's text does not start with its callee
		}
	}
	if isArrowBodyCall(call) || inCatchLeft(call) {
		return false
	}
	if ast.IsCallExpression(call) && isRuntimeExport(a.checker, ast.SkipParentheses(call.Expression()), "fork") {
		return false // fork(x) is the keyword form fork x
	}
	if parent := call.Parent; parent != nil && ast.IsOptionalChain(parent) && parent.Expression() == call && ast.IsOptionalChain(call) {
		return false // a?.f().g(): parentheses would end the chain
	}
	return runsWhereItStands(a, call)
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

// isArrowBodyCall reports whether call is the expression body of a function
// literal, as in () => f(), parentheses aside.
func isArrowBodyCall(call *ast.Node) bool {
	n := call
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	return n.Parent != nil && ast.IsArrowFunction(n.Parent) && n.Parent.Body() == n
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
// that has any.
func tryRewriteProject(ctx context.Context, program *compiler.Program) map[tspath.RootedFilePath][]sourceEdit {
	rewrites := map[tspath.RootedFilePath][]sourceEdit{}
	for _, file := range fixableFiles(program) {
		program.GetSemanticDiagnostics(ctx, file)
		c, done := program.GetTypeCheckerForFile(ctx, file)
		edits := tryEdits(c, file)
		done()
		if len(edits) > 0 {
			rewrites[file.FileName()] = edits
		}
	}
	return rewrites
}

// rewriteTries writes try before the running calls of program's files
// (tryEdits) where that adds no error to program's: in every file when they
// pass together, else in each file that passes on its own. An error whose
// message quotes a call with try, try f(), is the error that quoted f(). It
// records them in result and texts.
func rewriteTries(g *fixGate, fs vfs.FS, program *compiler.Program, texts map[tspath.RootedFilePath]string, result *FixResult) {
	rewrites := tryRewriteProject(g.ctx, program)
	if len(rewrites) == 0 {
		return
	}
	base := tryless(errorCounts(g.ctx, program))
	passes := func(overlay map[tspath.RootedFilePath]string) bool {
		for key, n := range tryless(errorCounts(g.ctx, g.build(maps(texts, overlay)))) {
			if n > base[key] {
				return false
			}
		}
		return true
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
		}
		fixed.Text = text
		texts[name] = text
	}
}

// tryless returns counts with try removed from each error's key.
func tryless(counts map[string]int) map[string]int {
	result := make(map[string]int, len(counts))
	for key, n := range counts {
		result[strings.ReplaceAll(key, "try ", "")] += n
	}
	return result
}
