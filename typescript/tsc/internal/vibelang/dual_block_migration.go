package vibelang

// D376/D382: a block param is always its call's last argument. Through
// VibeLang 0.0.10, D188 placed a block after an Effect dual where the dual
// takes its program: f(block, args) for a data-first signature, and
// f(args)(block) for a data-last or curried one. This file keeps that rule
// as a recorder that reads declared signatures only. No answer from it takes
// part in expression typing, form selection or emit.
//
// Where the appended call no longer type-checks, TypeScript's own error stays
// and explainDualBlock adds a note with the arrow spelling. Where it still
// type-checks, the block now means something else, which is EK1023. --fix
// writes the data-first arrow where a data-first signature exists, and the
// curried call otherwise: the two calls D188's lowering emitted,
// f(block, args) and f(args)(block), with the block written as an arrow.

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	checker.RegisterDiagnosticsFilterHook(explainDualBlock)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{1023}, GetCodeActions: dualBlockActions})
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2345, 2554, 2769}, GetCodeActions: dualBlockActions})
}

// dualBlockSilent is EK1023 for a block whose appended call still
// type-checks, so the callee receives it as something other than its program.
var dualBlockSilent = EK1023.With("This block is `{0}`'s last argument, which `{0}` accepts; through VibeLang 0.0.10 the block was `{0}`'s program.")

// dualBlockMigrationNote marks every dual-block site for the docs migration
// tool, as pipe_migration.go's note marks a pipe site.
const dualBlockMigrationNote = "Through VibeLang 0.0.10, a block after an Effect dual took the place of its program. vibelang --fix writes the arrow."

// legacyDualBlockForm is where D188 placed a block param through 0.0.10.
type legacyDualBlockForm uint8

const (
	dualBlockNone      legacyDualBlockForm = iota // appended, as every block is now
	dualBlockPrepended                            // f(block, args): a data-first dual takes its program first
	dualBlockApplied                              // f(args)(block): the call returns a function of the program
)

// legacyDualBlock returns D188's placement of call's block, read from the
// callee's declared signatures without overload resolution, in D188's order:
// prepended when a signature takes an Effect first and the written arguments
// after it; else applied when a signature that takes the written arguments
// returns a function whose first parameter is an Effect, unless another
// signature takes the block directly where that function takes it, as
// Layer.effect(S) { … } does. A block written with no arguments,
// f { block }, is never prepended: f(block) is already the data-first call.
// Nor is a block after an Effect written first where a data-first signature
// takes a value second, as in x |> Effect.bind(%, "name") { … }: the written
// arguments already fill that signature's program, so D188's other forms
// did not fit and the block was appended there.
func legacyDualBlock(c *checker.Checker, call *ast.Node) legacyDualBlockForm {
	if !isBlockParamCall(call) {
		return dualBlockNone
	}
	n := len(call.Arguments()) - 1
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(call.Expression()), checker.SignatureKindCall)
	if n > 0 && isEffectType(c, c.GetTypeAtLocation(call.Arguments()[0])) && slices.ContainsFunc(signatures, func(signature *checker.Signature) bool {
		parameters := signature.Parameters()
		return takesEffectFirst(c, signature) && acceptsArguments(signature, n+1) && len(parameters) > 1 && !isEffectType(c, c.GetTypeOfSymbol(parameters[1]))
	}) {
		return dualBlockNone
	}
	if n > 0 && slices.ContainsFunc(signatures, func(signature *checker.Signature) bool { return takesProgramFirst(c, signature, n) }) {
		return dualBlockPrepended
	}
	for _, signature := range signatures {
		if !acceptsArguments(signature, n) {
			continue
		}
		for _, inner := range c.GetSignaturesOfType(c.GetReturnTypeOfSignature(signature), checker.SignatureKindCall) {
			if takesEffectFirst(c, inner) && !takesBlockDirectly(c, signatures, n, inner) {
				return dualBlockApplied
			}
		}
	}
	return dualBlockNone
}

// takesProgramFirst reports whether signature takes an Effect first and n
// more arguments after it, which D188 rotated to take the block last.
func takesProgramFirst(c *checker.Checker, signature *checker.Signature, n int) bool {
	parameters := signature.Parameters()
	return takesEffectFirst(c, signature) && n+1 <= len(parameters) && signature.MinArgumentCount() <= n+1 &&
		!(signature.HasRestParameter() && n+1 >= len(parameters))
}

// takesBlockDirectly reports whether one of signatures takes the block as its
// own parameter n in the role inner takes it, an Effect parameter of the same
// name, as Layer.effect(service, effect) does beside its data-last form
// Layer.effect(service)(effect). D188 then appended the block.
func takesBlockDirectly(c *checker.Checker, signatures []*checker.Signature, n int, inner *checker.Signature) bool {
	name := inner.Parameters()[0].Name()
	for _, signature := range signatures {
		parameters := signature.Parameters()
		if n < len(parameters) && acceptsArguments(signature, n+1) && parameters[n].Name() == name && isEffectType(c, c.GetTypeOfSymbol(parameters[n])) {
			return true
		}
	}
	return false
}

func acceptsArguments(signature *checker.Signature, n int) bool {
	return n >= signature.MinArgumentCount() && (signature.HasRestParameter() || n <= len(signature.Parameters()))
}

// takesEffectFirst reports whether signature's first parameter is an Effect.
func takesEffectFirst(c *checker.Checker, signature *checker.Signature) bool {
	parameters := signature.Parameters()
	return len(parameters) != 0 && isEffectType(c, c.GetTypeOfSymbol(parameters[0]))
}

// dualBlockCalls returns file's block param calls that D188 placed
// elsewhere, outermost first.
func dualBlockCalls(c *checker.Checker, file *ast.SourceFile) []*ast.Node {
	if !isVibeLangFile(file) {
		return nil
	}
	var calls []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if inHatch(n) || n.Kind == ast.KindModuleDeclaration {
			return false
		}
		if ast.IsCallExpression(n) && legacyDualBlock(c, n) != dualBlockNone {
			calls = append(calls, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return calls
}

type dualBlockNotesKey struct{}

// explainDualBlock keeps TypeScript's error at a dual's block and adds the
// arrow spelling, or reports EK1023 where the appended call type-checks. It
// drops the EK4301 that the block draws as the plain callback a data-last
// signature's options parameter takes: that callback is the misplaced block.
func explainDualBlock(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
	calls := dualBlockCalls(c, file)
	if len(calls) == 0 {
		return ds
	}
	noted := c.ExtensionState(dualBlockNotesKey{}, func() any { return map[*ast.Diagnostic]bool{} }).(map[*ast.Diagnostic]bool)
	ds = slices.Clone(ds)
	for _, call := range calls {
		block := call.Arguments()[len(call.Arguments())-1]
		ds = slices.DeleteFunc(ds, func(d *ast.Diagnostic) bool {
			return d.Source() == diagnosticSource && d.Code() == EK4301.Code && innermostFunction(block, d.Loc()) == block
		})
		// TypeScript's error for the call, preferring one outside the block,
		// never one that belongs to another dual block nested in it.
		var found, inBody *ast.Diagnostic
		for _, d := range ds {
			if d.Source() != "" || d.Category() != diagnostics.CategoryError || d.Pos() < call.Pos() || call.End() < d.End() {
				continue
			}
			if slices.ContainsFunc(calls, func(other *ast.Node) bool {
				return other != call && call.Pos() <= other.Pos() && other.End() <= call.End() && other.Pos() <= d.Pos() && d.End() <= other.End()
			}) {
				continue
			}
			if strictlyInside(file, block.Body(), d.Loc()) {
				if inBody == nil {
					inBody = d
				}
				continue
			}
			found = d
			break
		}
		if found == nil {
			found = inBody
		}
		if found == nil {
			found = newDiagnostic(optionsFor(c, file), call, dualBlockSilent, nodeText(file, call.Expression()))
			if found == nil {
				continue
			}
			ds = append(ds, found)
		} else if noted[found] {
			continue
		} else {
			noted[found] = true
		}
		note(found, "{0}", dualBlockSpelling(c, file, call))
		note(found, dualBlockMigrationNote)
		if r := dualBlockRewrite(c, file, call); r != nil && r.why != "" {
			note(found, "{0}", r.why)
		}
	}
	return ds
}

// dualBlockSpelling is the note that names where the callee takes its
// program and gives the spelling with an arrow there.
func dualBlockSpelling(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	callee := nodeText(file, call.Expression())
	var args []string
	for _, argument := range call.Arguments()[:len(call.Arguments())-1] {
		args = append(args, expressionText(file, argument))
	}
	written := shortText(strings.Join(args, ", "), "…")
	if legacyDualBlock(c, call) == dualBlockPrepended {
		return "A block is its call's last argument. `" + callee + "` takes its program first: write `" + callee + "(() => { … }, " + written + ")`."
	}
	head := callee + "(" + written + ")"
	return "A block is its call's last argument. `" + head + "` returns the function that takes the program: write `" + head + "(() => { … })`."
}

// strictlyInside reports whether loc lies inside body's braces.
func strictlyInside(file *ast.SourceFile, body *ast.Node, loc core.TextRange) bool {
	return nodeStart(file, body) < loc.Pos() && loc.End() < body.End()
}

// innermostFunction returns the innermost function-like node of fn, or fn
// itself, whose span holds loc, or nil when fn's span does not.
func innermostFunction(fn *ast.Node, loc core.TextRange) *ast.Node {
	file := ast.GetSourceFileOfNode(fn)
	if loc.Pos() < fn.Pos() || fn.End() < loc.End() {
		return nil
	}
	inner := fn
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nodeStart(file, n) > loc.Pos() || n.End() < loc.End() {
			return false
		}
		if ast.IsFunctionLike(n) {
			inner = n
		}
		return n.ForEachChild(visit)
	}
	fn.ForEachChild(visit)
	return inner
}

// dualBlockRewrite plans the edits that keep the 0.0.10 meaning of call's
// block: the program first, f(() => { … }, args), where a data-first
// signature takes it, else the curried call, f(args)(() => { … }). The block
// moves before the written arguments, which still run in their order, and
// building an arrow does nothing observable, so the rewrite is exact.
func dualBlockRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "This block cannot be moved automatically: " + why}
	}
	form := legacyDualBlock(c, call)
	if form == dualBlockNone {
		return nil
	}
	if call.TypeArguments() != nil || ast.IsOptionalChain(call) {
		return refuse("explicit type arguments or an optional call need an explicit signature.")
	}
	text := file.Text()
	args := call.Arguments()
	block := args[len(args)-1]
	brace := nodeStart(file, block.Body())
	calleeEnd := call.Expression().End()
	head := strings.TrimRight(text[calleeEnd:brace], " \t")
	written := ""
	paren := -1
	if open := scanner.SkipTrivia(text, calleeEnd); open < brace && text[open] == '(' {
		paren = calleeEnd + len(head) - 1
		if text[paren] != ')' {
			return refuse("a comment stands between the call and its block.")
		}
		written = strings.TrimSpace(text[open+1 : paren])
	} else if strings.TrimSpace(head) != "" {
		return refuse("a comment stands between the call and its block.")
	}
	var edits []sourceEdit
	description := ""
	if form == dualBlockPrepended {
		for _, argument := range args[:len(args)-1] {
			if ast.IsSpreadElement(argument) {
				return refuse("a spread argument needs an explicit signature.")
			}
		}
		open := scanner.SkipTrivia(text, calleeEnd)
		edits = []sourceEdit{{open + 1, brace, "() => "}, {block.End(), block.End(), ", " + written + ")"}}
		description = "the program first, as the data-first signature takes it"
	} else {
		if paren < 0 {
			edits = []sourceEdit{{calleeEnd, brace, "()(() => "}, {block.End(), block.End(), ")"}}
		} else {
			edits = []sourceEdit{{paren + 1, brace, "(() => "}, {block.End(), block.End(), ")"}}
		}
		description = "the program applied to the curried call"
	}
	return &formRewrite{edits: edits, description: description}
}

func dualBlockActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	calls := dualBlockCalls(c, fix.SourceFile)
	// The innermost call whose span holds the diagnostic.
	for i := len(calls) - 1; i >= 0; i-- {
		call := calls[i]
		if call.Pos() <= fix.Span.Pos() && fix.Span.End() <= call.End() {
			r := dualBlockRewrite(c, fix.SourceFile, call)
			if !r.fixable() {
				return nil, nil
			}
			changes := replaceRange(fix, r.edits[0].start, r.edits[0].end, r.edits[0].text)
			changes = append(changes, replaceRange(fix, r.edits[1].start, r.edits[1].end, r.edits[1].text)...)
			return []*ls.CodeAction{{Description: "Pass the block where " + nodeText(fix.SourceFile, call.Expression()) + " takes its program", Changes: changes}}, nil
		}
	}
	return nil, nil
}

// dualBlockMigrationFixes proposes each dual block site's rewrite, the
// innermost first; a site whose edits overlap one taken waits for a round
// that rechecks the edited source.
func dualBlockMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, refuse func(FixRefusal, string)) proposal {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var candidates []fileFix
	for _, call := range dualBlockCalls(c, file) {
		key := "dualBlock:" + expressionText(file, call)
		if refused[key] {
			continue
		}
		r := dualBlockRewrite(c, file, call)
		if !r.fixable() {
			line, _ := scannerLineOf(file, nodeStart(file, call))
			refuse(FixRefusal{File: file.FileName(), Line: line + 1, Code: EK1023.Code, Error: r.why}, key)
			continue
		}
		candidates = append(candidates, fileFix{code: EK1023.Code, edits: r.edits, key: key})
	}
	slices.SortStableFunc(candidates, func(x, y fileFix) int {
		return x.edits[1].start - x.edits[0].start - (y.edits[1].start - y.edits[0].start)
	})
	p := proposal{file: file}
	var taken []sourceEdit
	for _, candidate := range candidates {
		if !slices.ContainsFunc(candidate.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			p.fixes = append(p.fixes, candidate)
			taken = append(taken, candidate.edits...)
		}
	}
	return p
}

// withFixes adds to p the fixes of more whose edits overlap none of p's.
func (p proposal) withFixes(more proposal) proposal {
	var taken []sourceEdit
	for _, f := range p.fixes {
		taken = append(taken, f.edits...)
	}
	for _, f := range more.fixes {
		if !slices.ContainsFunc(f.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			p.fixes = append(p.fixes, f)
			taken = append(taken, f.edits...)
		}
	}
	return p
}
