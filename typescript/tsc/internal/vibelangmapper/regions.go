package vibelangmapper

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Regions (rule 6: completion records across regions). A region is a block
// of an Effect function that runs as an Effect of its own, so that a runtime
// helper can wrap it: the blocks of a try statement ($catch, $finally), a
// provide block (Effect.provide), and the body and clauses of a handle
// statement (handle). As the fork lowers it (internal/vibelang/regions.go), a
// region is a generator, and a return, break, or continue that leaves it
// returns a completion record instead:
//
//	try { return find(id) } catch (e) { return guest }
//	const $c = yield* $catch($gen(function* () { return { kind: "return" as const, value: (yield* $run(find(id))) } }),
//	  (e) => $gen(function* () { return { kind: "return" as const, value: guest } })); return $c.value
//
// The generator that runs the region dispatches on the record: it returns,
// breaks, or continues itself, or, when it is a region's generator too and
// the jump leaves it as well, it returns the record to its own runner. A
// block that can end normally ends with $end when some jump leaves its
// region; a region that no jump leaves has no record to dispatch. The
// checking rendering returns a region's values boxed (prelude.d.ts, $box),
// so they keep the types TypeScript infers for the source's returns.

// A jump is where a return, break, or continue statement goes.
type jump struct {
	kind  ast.Kind // ast.KindReturnStatement, ast.KindBreakStatement, or ast.KindContinueStatement
	label string   // the target label; "" for return and for an unlabeled break or continue
}

// region collects the jumps that leave a region while the walk lowers its blocks.
type region struct {
	jumps []jump
	// tail reports that the region's statement ends its Effect function's
	// own body (isTailRegion).
	tail bool
	// labeled reports that a label marks the region's statement, which then
	// projects to a block.
	labeled bool
}

// isTailRegion reports whether node, a region statement, is the last
// statement of an Effect function's own body. After it the function ends,
// so the region's blocks may fall off their ends: the generator's return
// type then holds undefined exactly where TypeScript finds the end
// reachable, an exhaustive switch included, and the dispatch returns the
// completion unconditionally, as the function's own end would.
func isTailRegion(node *ast.Node, e env) bool {
	if e.frame == nil || e.frame.region != nil || len(e.frame.targets) != 0 {
		return false
	}
	block := node.Parent
	if block == nil || block.Kind != ast.KindBlock || block.Parent == nil || !ast.IsFunctionLike(block.Parent) {
		return false
	}
	statements := block.Statements()
	return len(statements) > 0 && statements[len(statements)-1] == node
}

func (r *region) add(j jump) {
	if !slices.Contains(r.jumps, j) {
		r.jumps = append(r.jumps, j)
	}
}

// A frame is one generator the projection writes: an Effect function's own
// body, or a region's block.
type frame struct {
	region  *region  // the region whose block this is; nil for an Effect function's body
	targets []target // the statements a break or continue can jump to, innermost last
	// expression reports that the generator's body is one expression, a
	// lambda's, which owns its forks as a block body does (D353).
	expression bool
}

// A target is a statement that break or continue can jump to: a loop, a
// switch, or a labeled statement.
type target struct {
	label string // the label of a labeled statement; "" for a loop or a switch
	loop  bool   // continue can jump to it
}

// newEffectEnv returns the env of a new Effect body: a generator of its own.
func newEffectEnv() env {
	return env{effect: true, frame: &frame{}}
}

// regionEnv returns the env of one block of region r, inside the code of e.
func regionEnv(r *region, e env) env {
	return env{effect: true, frame: &frame{region: r}, continuation: e.continuation, voidFail: e.voidFail, producer: e.producer}
}

// lands reports whether j lands in f, so that f can jump itself instead of
// returning a completion record.
func (f *frame) lands(j jump) bool {
	if j.kind == ast.KindReturnStatement {
		return f.region == nil
	}
	for i := len(f.targets) - 1; i >= 0; i-- {
		t := f.targets[i]
		switch {
		case j.label != "":
			if t.label == j.label {
				return true
			}
		case t.label == "" && (t.loop || j.kind == ast.KindBreakStatement):
			return true
		}
	}
	return false
}

// isJumpTarget reports whether node is a statement that break or continue
// can jump to.
func isJumpTarget(node *ast.Node) bool {
	return node.Kind == ast.KindLabeledStatement || node.Kind == ast.KindSwitchStatement || ast.IsIterationStatement(node, false /*lookInLabeledStatements*/)
}

// jumpTarget walks node, a loop, switch, or labeled statement in an Effect
// body, with node open as a jump target of e's frame.
func (p *projector) jumpTarget(node *ast.Node, e env) {
	t := target{loop: ast.IsIterationStatement(node, false /*lookInLabeledStatements*/)}
	if node.Kind == ast.KindLabeledStatement {
		statement := node.AsLabeledStatement()
		t = target{label: statement.Label.Text(), loop: ast.IsIterationStatement(statement.Statement, true /*lookInLabeledStatements*/)}
	}
	f := e.frame
	f.targets = append(f.targets, t)
	p.visitChildren(node, e)
	f.targets = f.targets[:len(f.targets)-1]
}

// jumpKind is the kind a jump's completion takes: "break:label" or
// "continue:label".
func jumpKind(j jump) string {
	if j.kind == ast.KindBreakStatement {
		return "break:" + j.label
	}
	return "continue:" + j.label
}

// returnStatement records a return in a region's block as a jump that
// leaves the region. In the checking rendering the region's generator
// returns the value boxed, `return $box(x)`, which the dispatch narrows
// back to the value (prelude.d.ts); a return without a value stays. The
// executable rendering will return the record { kind: "return", value }.
func (p *projector) returnStatement(node *ast.Node, e env) {
	e.frame.region.add(jump{kind: ast.KindReturnStatement})
	start := p.tokenStart(node)
	expression := node.Expression()
	if expression == nil {
		p.plan.mark(editRecord, partOpen, start, start, "return")
		p.plan.mark(editRecord, partClose, node.End(), node.End(), "return")
		return
	}
	from := start
	if p.isCompletionReturn(node) {
		// A do expression's completion value: no return keyword to replace.
		from = p.tokenStart(expression)
	}
	p.plan.mark(editRecord, partOpen, from, p.tokenStart(expression), "return value")
	p.visit(expression, e)
	p.plan.mark(editRecord, partClose, expression.End(), expression.End(), "return value")
}

// jumpStatement lowers a break or continue that leaves the region of e's
// frame to the completion of that jump, `return $jump("break:label")`; one
// that lands in the frame stays.
func (p *projector) jumpStatement(node *ast.Node, e env) {
	j := jump{kind: node.Kind}
	if label := node.Label(); label != nil {
		j.label = label.Text()
	}
	if e.frame.lands(j) || e.frame.region == nil {
		return
	}
	e.frame.region.add(j)
	text := "return " + helperRef("$jump") + "(" + strconv.Quote(jumpKind(j)) + ")"
	// The statement's own semicolon ends the replacement too, as in
	// `if (done) continue; else work()`, where ASI cannot insert one.
	if end := node.End(); end > 0 && p.text[end-1] == ';' {
		text += ";"
	}
	p.plan.markText(editRecord, partWhole, p.tokenStart(node), node.End(), text)
}

// openRegion returns the text that starts a region statement whose record
// is held in name, or "" when no jump leaves r: `const $c = yield* `. A
// region statement a label marks is a block, since a declaration cannot be
// labeled: `label: { const $c = ...; dispatch }`.
func openRegion(r *region, name string) string {
	open := "yield* "
	if len(r.jumps) > 0 {
		open = "const " + name + " = yield* "
	}
	if r.labeled {
		open = "{ " + open
	}
	return open
}

// dispatch returns the statements that act on the completion in name
// after a region statement in e's frame: each jump that lands in the frame
// is taken, and each that does not is passed on, as the frame's own
// completion. When the statement cannot end normally, the last one is
// unconditional.
func (p *projector) dispatch(r *region, name string, normal bool, e env) string {
	text := p.dispatchStatements(r, name, normal, e)
	if r.labeled {
		text += " }"
	}
	return text
}

// dispatchStatements returns dispatch's statements, before any closing
// brace of a labeled region statement.
func (p *projector) dispatchStatements(r *region, name string, normal bool, e env) string {
	if r.tail {
		normal = false
	}
	var out []string
	for i, j := range r.jumps {
		var action string
		switch {
		case !e.frame.lands(j) && e.frame.region != nil:
			// Passed on to the enclosing region. A narrowed return value
			// is boxed again, so the enclosing generator does not widen it.
			e.frame.region.add(j)
			action = "return " + name
			if j.kind == ast.KindReturnStatement && (normal || i < len(r.jumps)-1) {
				action = "return " + helperRef("$box") + "(" + name + ")"
			}
		case j.kind == ast.KindReturnStatement:
			action = "return " + name
			if !normal && i == len(r.jumps)-1 {
				action = "return " + helperRef("$unboxed") + "(" + name + ")"
			}
		case j.kind == ast.KindBreakStatement:
			// At a function boundary, preserve an unresolved jump for
			// TypeScript to diagnose instead of forwarding to a nil region.
			action = strings.TrimSpace("break " + j.label)
		default:
			action = strings.TrimSpace("continue " + j.label)
		}
		if !normal && i == len(r.jumps)-1 {
			out = append(out, action)
			continue
		}
		condition := helperRef("$returned") + "(" + name + ")"
		if j.kind != ast.KindReturnStatement {
			condition = helperRef("$jumped") + "(" + name + ", " + strconv.Quote(jumpKind(j)) + ")"
		}
		out = append(out, "if ("+condition+") "+action)
	}
	if len(out) == 0 {
		return ""
	}
	return "; " + strings.Join(out, "; ")
}

// regionBlock walks block, a braced block of region r, in a frame of its
// own, and returns whether it can end normally. When r ends up with jumps,
// a block that can end normally returns $end.
func (p *projector) regionBlock(block *ast.Node, statements []*ast.Node, r *region, e env) (normal bool, closeNormal func()) {
	p.visitList(statements, regionEnv(r, e))
	normal = canCompleteNormally(statements)
	closing := block.End() - 1
	return normal, func() {
		if normal && len(r.jumps) > 0 && !r.tail && closing >= 0 && p.text[closing] == '}' {
			p.plan.markText(editRecord, partWhole, closing, closing, "; return "+helperRef("$end")+" ")
		}
	}
}

// freshCompletion returns a name for the completion record of a region
// statement that no word of the file and no other region uses.
func (p *projector) freshCompletion() string {
	for {
		p.completions++
		name := "$c"
		if p.completions > 1 {
			name += "_" + strconv.Itoa(p.completions-1)
		}
		if !p.names.words[name] {
			return name
		}
	}
}

// generatorOpen is the text that opens a region block's generator, with
// this passed in when the block refers to it. A block whose own statements
// hold a using or a fork the block owns runs under $scopedBody, so its
// Scope ends with it (scopeBlock); generatorClose closes what this opens.
func (p *projector) generatorOpen(block *ast.Node) string {
	open := helperRef("$gen") + "(" + selfPrefix(block) + "function* () "
	if p.holdsScope(block.Statements()) {
		open = helperRef("$scopedBody") + "(" + open
	}
	return open
}

// generatorClose closes what generatorOpen opened for block.
func (p *projector) generatorClose(block *ast.Node) string {
	if p.holdsScope(block.Statements()) {
		return "))"
	}
	return ")"
}

// tryStatement lowers a try statement in an Effect body to its region:
// `$catch(try, (e) => catch)` for a catch clause and `$finally(try, finally)`
// for a finally block, each block a generator. A typed catch clause, the
// retired form (L4), and a clause typed Cause (D176) are not lowered yet.
func (p *projector) tryStatement(node *ast.Node, e env) {
	statement := node.AsTryStatement()
	tryBlock, catch, finally := statement.TryBlock, statement.CatchClause, statement.FinallyBlock
	if catch != nil {
		if variable := catch.AsCatchClause().VariableDeclaration; variable != nil &&
			(variable.Type() != nil || variable.Flags&ast.NodeFlagsReparsed != 0 || variable.Name().Flags&ast.NodeFlagsReparsed != 0) {
			p.unprojected(variable)
			p.visitChildren(node, e)
			return
		}
	}
	r := &region{tail: isTailRegion(node, e), labeled: node.Parent != nil && node.Parent.Kind == ast.KindLabeledStatement}
	name := p.freshCompletion()
	// Reserved first: a handle statement followed by catch or finally is
	// the try block itself, and its own edits start at the same position.
	opening := p.plan.reserve(editRegion, partOpen, p.tokenStart(node), p.tokenStart(tryBlock))
	// The try block of `try { } handle ... catch` is the handle statement,
	// with no braces of its own; its generator gets them.
	synthetic := p.text[p.tokenStart(tryBlock)] != '{'
	tryNormal, closeTry := p.regionBlock(tryBlock, tryBlock.Statements(), r, e)
	if synthetic {
		closeTry = func() {
			text := " }"
			if tryNormal && len(r.jumps) > 0 && !r.tail {
				text = "; return " + helperRef("$end") + " }"
			}
			p.plan.markText(editRecord, partWhole, tryBlock.End(), tryBlock.End(), text)
		}
	}
	normal := tryNormal
	var closeCatch, closeFinally func()
	var catchBlock *ast.Node
	if catch != nil {
		catchBlock = catch.AsCatchClause().Block
		catchNormal, closer := p.regionBlock(catchBlock, catchBlock.Statements(), r, e)
		closeCatch = closer
		normal = tryNormal || catchNormal
	}
	exit := (*ast.Node)(nil)
	if finally != nil {
		// The finalizer's value is dropped; a jump out of it is a record too.
		statements := finally.Statements()
		if exit = exitBinding(finally); exit != nil {
			statements = statements[1:]
		}
		finallyNormal, closer := p.regionBlock(finally, statements, r, e)
		closeFinally = closer
		normal = normal && finallyNormal
	}
	closeTry()
	if closeCatch != nil {
		closeCatch()
	}
	if closeFinally != nil {
		closeFinally()
	}

	open := openRegion(r, name)
	if finally != nil {
		if exit != nil {
			open += helperRef("$finallyExit") + "("
		} else {
			open += helperRef("$finally") + "("
		}
	}
	if catch != nil {
		open += helperRef("$catch") + "("
	}
	if synthetic {
		open += p.generatorOpen(tryBlock) + "{ "
	} else {
		open += p.generatorOpen(tryBlock)
	}
	p.plan.edits[opening].text = open
	after := tryBlock.End()
	if catch != nil {
		clause := catch.AsCatchClause()
		if variable := clause.VariableDeclaration; variable != nil {
			p.plan.markText(editRegion, partMiddle, after, p.tokenStart(variable), p.generatorClose(tryBlock)+", (")
			p.visit(variable, env{})
			p.plan.markText(editRegion, partMiddle, variable.End(), p.tokenStart(catchBlock), ") => "+p.generatorOpen(catchBlock))
		} else {
			p.plan.markText(editRegion, partMiddle, after, p.tokenStart(catchBlock), p.generatorClose(tryBlock)+", () => "+p.generatorOpen(catchBlock))
		}
		after = catchBlock.End()
		p.plan.markText(editRegion, closeUnless(finally != nil), after, after, p.generatorClose(catchBlock)+")")
	} else {
		p.plan.markText(editRegion, closeUnless(finally != nil), after, after, p.generatorClose(tryBlock))
	}
	if finally != nil && exit != nil {
		// finally (exit) { ... }: the finalizer receives the try's Exit.
		brace := p.braceAfter(exit.End())
		p.plan.markText(editRegion, partMiddle, after, p.tokenStart(exit), ", (")
		p.visit(exit, env{})
		p.plan.markText(editRegion, partMiddle, exit.End(), brace, ") => "+p.generatorOpen(finally))
		after = finally.End()
		p.plan.markText(editRegion, partClose, after, after, p.generatorClose(finally)+")")
	} else if finally != nil {
		p.plan.markText(editRegion, partMiddle, after, p.tokenStart(finally), ", "+p.generatorOpen(finally))
		after = finally.End()
		p.plan.markText(editRegion, partClose, after, after, p.generatorClose(finally)+")")
	}
	p.plan.markText(editDispatch, partWhole, after, after, p.dispatch(r, name, normal, e))
}

// closeUnless returns partMiddle when more of the construct follows, and
// partClose when this edit ends it.
func closeUnless(more bool) part {
	if more {
		return partMiddle
	}
	return partClose
}

// isProvideBlock reports whether node is a provide block (D130, D172): a
// block flagged NodeFlagsVibeLang whose first statement, flagged too, holds
// the providers.
func isProvideBlock(node *ast.Node) bool {
	if node.Kind != ast.KindBlock || node.Flags&ast.NodeFlagsVibeLang == 0 {
		return false
	}
	statements := node.Statements()
	return len(statements) > 0 && statements[0].Kind == ast.KindExpressionStatement && statements[0].Flags&ast.NodeFlagsVibeLang != 0
}

// provideBlock lowers `provide Layers { statements }` in an Effect body to
// its region, `Effect.provide(Layers)(program)`, which keeps the source order:
// the providers come first. Several providers become an array, and a
// provider written Key = value the layer $provideService(Key, "Key", value)
// that provides that one service (D173, D175). A list with such a provider
// runs under $provideEntries instead, typed as Effect.provide, which provides
// those services as Effect.provideService does and builds no Layer for them.
func (p *projector) provideBlock(node *ast.Node, e env) {
	statements := node.Statements()
	providers := statements[0].Expression()
	items := []*ast.Node{providers}
	array := false
	if providers.Kind == ast.KindArrayLiteralExpression && providers.Flags&ast.NodeFlagsReparsed == 0 && !p.isWrittenArray(providers) {
		items = providers.Elements()
		array = true
	} else if isProvideService(providers) {
		array = true
	}
	if len(items) == 0 {
		p.unprojected(node)
		return
	}
	first, last := items[0], items[len(items)-1]
	brace := p.braceAfter(p.lastTokenEnd(last))
	closing := node.End() - 1
	if brace < 0 || closing <= brace || p.text[closing] != '}' {
		p.unprojected(node)
		return
	}
	r := &region{tail: isTailRegion(node, e), labeled: node.Parent != nil && node.Parent.Kind == ast.KindLabeledStatement}
	name := p.freshCompletion()
	body := statements[1:]
	p.visitList(body, regionEnv(r, e))
	normal := canCompleteNormally(body)
	if normal && len(r.jumps) > 0 && !r.tail {
		p.plan.markText(editRecord, partWhole, closing, closing, "; return "+helperRef("$end")+" ")
	}

	open := openRegion(r, name) + p.names.prelude("Effect") + ".provide("
	if slices.ContainsFunc(items, isProvideService) {
		open = openRegion(r, name) + helperRef("$provideEntries") + "("
	}
	if array {
		open += "["
	}
	p.plan.markText(editRegion, partOpen, p.tokenStart(node), p.tokenStart(first), open)
	for i, item := range items {
		p.provider(item)
		if i < len(items)-1 {
			continue
		}
	}
	middle := ")("
	if array {
		middle = "])("
	}
	p.plan.markText(editRegion, partMiddle, p.lastTokenEnd(last), brace, middle+p.generatorOpen(node))
	p.plan.markText(editRegion, partClose, node.End(), node.End(), p.generatorClose(node)+")")
	p.plan.markText(editDispatch, partWhole, node.End(), node.End(), p.dispatch(r, name, normal, e))
}

// isWrittenArray reports whether array, an array literal of providers, is
// written in the source as one, rather than made by the parser from
// providers separated by commas.
func (p *projector) isWrittenArray(array *ast.Node) bool {
	start := p.tokenStart(array)
	return start < len(p.text) && p.text[start] == '['
}

// isProvideService reports whether node is the parser's
// $provideService(Key, "Key", value) for a provider written Key = value.
func isProvideService(node *ast.Node) bool {
	return node.Kind == ast.KindCallExpression && node.Expression().Kind == ast.KindIdentifier &&
		node.Expression().Flags&ast.NodeFlagsReparsed != 0 && node.Expression().Text() == "$provideService"
}

// provider lowers one provider of a provide block: Key = value becomes
// $provideService(Key, "Key", value); any other provider stays.
func (p *projector) provider(item *ast.Node) {
	if !isProvideService(item) {
		p.visit(item, env{})
		return
	}
	arguments := item.Arguments()
	key, label, value := arguments[0], arguments[1], arguments[2]
	p.plan.insert(p.tokenStart(key), helperRef("$provideService")+"(")
	p.visit(key, env{})
	p.plan.replace(key.End(), p.tokenStart(value), ", "+strconv.Quote(label.Text())+", ")
	p.visit(value, env{})
	p.plan.insert(value.End(), ")")
}

// lastTokenEnd returns the end of node's last token.
func (p *projector) lastTokenEnd(node *ast.Node) int {
	return node.End()
}

// braceAfter returns the position of the first { after pos, skipping
// trivia and the closing parenthesis of provide(...) { ... }, or -1.
func (p *projector) braceAfter(pos int) int {
	for i := scanner.SkipTrivia(p.text, pos); i < len(p.text); i = scanner.SkipTrivia(p.text, i+1) {
		switch p.text[i] {
		case '{':
			return i
		case ')':
			continue
		}
		return -1
	}
	return -1
}

// canCompleteNormally reports whether a statement list can end by falling
// off its end, read from syntax: a return, throw, break, or continue does
// not, nor an if whose branches both do not. It errs toward true.
func canCompleteNormally(statements []*ast.Node) bool {
	for _, statement := range statements {
		if !completes(statement) {
			return false
		}
	}
	return true
}

// completes reports whether statement can end normally (canCompleteNormally).
func completes(statement *ast.Node) bool {
	switch statement.Kind {
	case ast.KindReturnStatement, ast.KindThrowStatement, ast.KindBreakStatement, ast.KindContinueStatement:
		return false
	case ast.KindBlock:
		return canCompleteNormally(statement.Statements())
	case ast.KindIfStatement:
		s := statement.AsIfStatement()
		return s.ElseStatement == nil || completes(s.ThenStatement) || completes(s.ElseStatement)
	case ast.KindTryStatement:
		s := statement.AsTryStatement()
		normal := completes(s.TryBlock)
		if s.CatchClause != nil {
			normal = normal || completes(s.CatchClause.AsCatchClause().Block)
		}
		return normal && (s.FinallyBlock == nil || completes(s.FinallyBlock))
	case ast.KindSwitchStatement:
		clauses := statement.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes
		hasDefault, fallsThrough := false, true
		for i := len(clauses) - 1; i >= 0; i-- {
			clause := clauses[i]
			hasDefault = hasDefault || clause.Kind == ast.KindDefaultClause
			if breaksSwitch(clause) {
				return true
			}
			fallsThrough = canCompleteNormally(clause.Statements()) && fallsThrough
			if fallsThrough {
				return true
			}
		}
		return !hasDefault
	case ast.KindLabeledStatement:
		return true
	}
	return true
}

// breaksSwitch finds a reachable syntactic exit to the enclosing switch.
// Nested loops and switches own their unlabeled breaks; functions own theirs.
// Keeping unreachable breaks is conservative, as completes is elsewhere.
func breaksSwitch(node *ast.Node) bool {
	if ast.IsFunctionLike(node) || ast.IsIterationStatement(node, false) || node.Kind == ast.KindSwitchStatement {
		return false
	}
	if node.Kind == ast.KindBreakStatement {
		return node.AsBreakStatement().Label == nil
	}
	return node.ForEachChild(breaksSwitch)
}

// A handleGroup is the clauses of a handle statement for one control, in
// source order.
type handleGroup struct {
	control string // the control's text, as the operations name it
	clauses []handleClause
}

// A handleClause is one clause of a handle statement as the parser reads
// it: its block, whose first statement binds the continuation and the
// parameters, and the operation it answers.
type handleClause struct {
	block      *ast.Node
	binding    *ast.Node
	operation  *ast.Node // Control.operation
	parameters []*ast.Node
	body       []*ast.Node // the clause's own statements
}

// handleClauses reads the clauses of a handle statement from the if chain
// the parser writes in its catch block (internal/parser/vibelang.go), grouped
// by control. ok is false when clauses of one control do not stand together.
func handleClauses(node *ast.Node) (groups []handleGroup, ok bool) {
	catch := node.AsTryStatement().CatchClause
	if catch == nil {
		return nil, false
	}
	statements := catch.AsCatchClause().Block.Statements()
	if len(statements) != 1 {
		return nil, false
	}
	for link := statements[0]; link != nil; {
		if link.Kind != ast.KindIfStatement {
			return nil, false
		}
		s := link.AsIfStatement()
		block := s.ThenStatement
		if block.Kind != ast.KindBlock {
			// catch (e) { if (x) throw e } has no clause block.
			return nil, false
		}
		inner := block.Statements()
		if len(inner) == 0 || inner[0].Kind != ast.KindVariableStatement || inner[0].Flags&ast.NodeFlagsVibeLang == 0 {
			return nil, false
		}
		declaration := inner[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
		call := declaration.Initializer()
		if call == nil || call.Kind != ast.KindCallExpression || len(call.Arguments()) != 1 {
			return nil, false
		}
		operation := call.Arguments()[0]
		if operation.Kind != ast.KindPropertyAccessExpression {
			return nil, false
		}
		elements := declaration.Name().Elements()
		clause := handleClause{block: block, binding: inner[0], operation: operation, parameters: elements[1:], body: inner[1:]}
		control := operation.Expression()
		key := scannerText(control)
		if control.Kind == ast.KindIdentifier {
			key = control.Text()
		}
		if n := len(groups); n > 0 && groups[n-1].control == key {
			groups[n-1].clauses = append(groups[n-1].clauses, clause)
		} else {
			for _, g := range groups {
				if g.control == key {
					return nil, false
				}
			}
			groups = append(groups, handleGroup{control: key, clauses: []handleClause{clause}})
		}
		link = s.ElseStatement
	}
	return groups, len(groups) > 0
}

// scannerText returns the source text of node, or "" for a node the parser
// synthesized.
func scannerText(node *ast.Node) string {
	file := ast.GetSourceFileOfNode(node)
	if file == nil || node.Flags&ast.NodeFlagsReparsed != 0 {
		return ""
	}
	text := file.Text()
	return text[scanner.SkipTrivia(text, node.Pos()):node.End()]
}

// handleStatement lowers a handle statement (D132) in an Effect body to the
// runtime's handle, one call per control, the first control innermost:
//
//	try { B } handle Approval.approve(request) { C }
//	const $c = yield* handle($gen(function* () { B }), Approval, { approve: (request, $k) => $gen(function* () { C }) })
//
// The block and the clauses are blocks of one region: a return, break, or
// continue in either leaves the statement through a completion record. In a
// clause, the parser passes the continuation to resume, resumeWith, and
// abandon, and a resume in tail position returns the runtime's tail-resume
// request (D18).
func (p *projector) handleStatement(node *ast.Node, e env) {
	groups, ok := handleClauses(node)
	body := node.AsTryStatement().TryBlock
	if !ok || p.tokenStart(body) >= len(p.text) || p.text[p.tokenStart(body)] != '{' {
		p.unprojected(node)
		return
	}
	r := &region{tail: isTailRegion(node, e), labeled: node.Parent != nil && node.Parent.Kind == ast.KindLabeledStatement}
	name := p.freshCompletion()
	k := p.freshWord("$k")
	var closers []func()
	normal, closer := p.regionBlock(body, body.Statements(), r, e)
	closers = append(closers, closer)
	type clauseBraces struct{ open, close int }
	braces := map[*ast.Node]clauseBraces{}
	for _, group := range groups {
		for _, clause := range group.clauses {
			open := p.clauseBodyBrace(clause)
			closing := clause.block.End() - 1
			if open < 0 || p.text[closing] != '}' {
				p.unprojected(node)
				return
			}
			braces[clause.block] = clauseBraces{open, closing}
			ce := regionEnv(r, e)
			ce.continuation = k
			p.visitList(clause.body, ce)
			clauseNormal := canCompleteNormally(clause.body)
			normal = normal || clauseNormal
			closers = append(closers, func() {
				if clauseNormal && len(r.jumps) > 0 && !r.tail {
					p.plan.markText(editRecord, partWhole, closing, closing, "; return "+helperRef("$end")+" ")
				}
			})
		}
	}
	for _, closer := range closers {
		closer()
	}
	open := openRegion(r, name) + strings.Repeat(helperRef("handle")+"(", len(groups))
	p.plan.markText(editRegion, partOpen, p.tokenStart(node), p.tokenStart(body), open+p.generatorOpen(body))
	p.plan.markText(editRegion, partMiddle, body.End(), body.End(), p.generatorClose(body))
	for g, group := range groups {
		for i, clause := range group.clauses {
			handleKeyword := p.tokenStart(clause.block)
			operation := clause.operation
			control, member := operation.Expression(), operation.Name()
			if i == 0 {
				// , Approval, { approve: (request, $k) => ...
				p.plan.markText(editRegion, partMiddle, handleKeyword, p.tokenStart(control), ", ")
				p.visit(control, env{})
				p.plan.markText(editRegion, partMiddle, control.End(), p.tokenStart(member), ", { ")
			} else {
				p.plan.markText(editRegion, partMiddle, handleKeyword, p.tokenStart(member), ", ")
			}
			b := braces[clause.block]
			var params []*ast.Node
			for _, parameter := range clause.parameters {
				if parameter.Kind == ast.KindBindingElement && parameter.Flags&ast.NodeFlagsReparsed == 0 {
					params = append(params, parameter)
				}
			}
			if len(params) == 0 {
				p.plan.markText(editRegion, partMiddle, member.End(), b.open, ": ("+k+") => "+p.generatorOpen(clause.block))
			} else {
				p.plan.markText(editRegion, partMiddle, member.End(), p.tokenStart(params[0]), ": (")
				for _, parameter := range params {
					p.visit(parameter, env{})
				}
				padding := p.omittedClauseBindings(control, member, len(params))
				p.plan.markText(editRegion, partMiddle, params[len(params)-1].End(), b.open, padding+", "+k+") => "+p.generatorOpen(clause.block))
			}
			separator := p.generatorClose(clause.block)
			if i == len(group.clauses)-1 {
				separator += " })"
			}
			p.plan.markText(editRegion, closeUnless(g < len(groups)-1 || i < len(group.clauses)-1), b.close+1, b.close+1, separator)
		}
	}
	end := node.End()
	p.plan.markText(editDispatch, partWhole, end, end, p.dispatch(r, name, normal, e))
}

// clauseBodyBrace returns the position of the { that opens a handle
// clause's own block, after its parameter list, or -1.
func (p *projector) clauseBodyBrace(clause handleClause) int {
	pos := clause.operation.End()
	if n := len(clause.parameters); n > 0 && clause.parameters[n-1].Flags&ast.NodeFlagsReparsed == 0 {
		pos = clause.parameters[n-1].End()
	}
	depth := 0
	for i := scanner.SkipTrivia(p.text, pos); i < len(p.text); i = scanner.SkipTrivia(p.text, i+1) {
		switch p.text[i] {
		case '(':
			depth++
		case ')':
			depth--
		case '{':
			if depth <= 0 {
				return i
			}
		default:
			if depth <= 0 {
				return -1
			}
		}
	}
	return -1
}

// freshWord returns name, or name with a numeric suffix, that no word of
// the file spells, for a synthesized local such as a clause's continuation.
func (p *projector) freshWord(name string) string {
	if !p.names.words[name] {
		return name
	}
	for i := 1; ; i++ {
		if candidate := name + "_" + strconv.Itoa(i); !p.names.words[candidate] {
			return candidate
		}
	}
}

// isContinuationArgument reports whether node is the continuation the parser
// passes to resume, resumeWith, or abandon in a handle clause.
func isContinuationArgument(node *ast.Node) bool {
	return node.Kind == ast.KindIdentifier && node.Flags&ast.NodeFlagsReparsed != 0 && node.Text() == "$k"
}

// resumeCall lowers the arguments of resume, resumeWith, or abandon in a
// handle clause: the parser's continuation becomes the clause's, and resume()
// passes undefined, as the parser writes it.
func (p *projector) continuationArguments(call *ast.Node, e env) {
	arguments := call.Arguments()
	open := scanner.SkipTrivia(p.text, call.Expression().End())
	if call.TypeArgumentList() != nil {
		open = scanner.SkipTrivia(p.text, call.TypeArgumentList().End()+1)
	}
	var written []*ast.Node
	for _, argument := range arguments[1:] {
		if argument.Flags&ast.NodeFlagsReparsed == 0 {
			written = append(written, argument)
		}
	}
	text := e.continuation
	switch {
	case len(written) > 0:
		text += ", "
	case len(arguments) > 1:
		text += ", undefined"
	}
	p.plan.insert(open+1, text)
	for _, argument := range written {
		p.visit(argument, e)
	}
}

// isTailResume reports whether node is the return the parser writes for a
// resume or resumeWith in tail position of a handle clause.
func isTailResume(node *ast.Node) bool {
	if node.Kind != ast.KindReturnStatement || node.Flags&ast.NodeFlagsVibeLang == 0 || node.Expression() == nil {
		return false
	}
	call := node.Expression()
	return call.Kind == ast.KindCallExpression && len(call.Arguments()) > 0 && isContinuationArgument(call.Arguments()[0])
}

// tailResume lowers a tail resume to the tail-resume request it returns:
// `resume(v)` becomes `return $tailResume($k, v)`.
func (p *projector) tailResume(node *ast.Node, e env) {
	call := node.Expression()
	callee := call.Expression()
	helper := "$tailResume"
	if callee.Text() == "resumeWith" {
		helper = "$tailResumeWith"
	}
	p.plan.insert(p.tokenStart(node), "return ")
	p.plan.replace(p.tokenStart(callee), callee.End(), helperRef(helper))
	p.continuationArguments(call, e)
}

// isUsingDeclaration reports whether node declares with using: in an
// Effect body, an acquisition or a Disposable the block releases (D47).
func isUsingDeclaration(node *ast.Node) bool {
	if node.Kind != ast.KindVariableStatement {
		return false
	}
	list := node.AsVariableStatement().DeclarationList
	return list.Flags&ast.NodeFlagsUsing != 0 && list.Flags&ast.NodeFlagsAwaitUsing != ast.NodeFlagsAwaitUsing
}

// usingDeclaration lowers `using x = acquire()` in an Effect body to
// `const x = (yield* $acquire(acquire()))`. The initializer passes by name:
// its own call does not run, so $acquire receives the acquisition, and the
// block's Scope leaves its R (D14). A Disposable is acquired as itself.
func (p *projector) usingDeclaration(node *ast.Node, e env) {
	list := node.AsVariableStatement().DeclarationList
	start := p.tokenStart(list)
	if !strings.HasPrefix(p.text[start:], "using") {
		p.unprojected(node)
		return
	}
	p.plan.replace(start, start+len("using"), "const")
	for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
		p.visit(declaration.Name(), env{})
		if t := declaration.Type(); t != nil {
			p.visit(t, env{})
		}
		init := declaration.Initializer()
		if init == nil {
			continue
		}
		p.plan.mark(editUsing, partOpen, p.tokenStart(init), p.tokenStart(init), "")
		p.byName(init, e)
		p.plan.mark(editUsing, partClose, init.End(), init.End(), "")
	}
}

// byName walks expr, an argument passed by name: a call at its top does not
// run, though its callee and arguments are lowered as in any call.
func (p *projector) byName(expr *ast.Node, e env) {
	if expr.Kind == ast.KindCallExpression && isRunnableCall(expr) {
		// D14: defer only the outer run, retaining data-method rewrites
		// and the runs of nested receivers and arguments.
		first := len(p.plan.edits)
		p.runCall(expr, e)
		last := len(p.plan.edits) - 1
		if first <= last && p.plan.edits[first].kind == editRun && p.plan.edits[last].kind == editRun && p.plan.edits[first].pos == p.tokenStart(expr) && p.plan.edits[last].pos == expr.End() {
			p.plan.edits = append(p.plan.edits[:last], p.plan.edits[last+1:]...)
			p.plan.edits = append(p.plan.edits[:first], p.plan.edits[first+1:]...)
		}
		return
	}
	p.visit(expr, e)
}

// maskWord returns the interruption block's word, uninterruptible, restore,
// or interruptible, when node is such a block: a block whose first statement
// calls the parser's marker, such as $uninterruptibleBlock(). It returns "".
func maskWord(node *ast.Node) string {
	if node.Kind != ast.KindBlock {
		return ""
	}
	statements := node.Statements()
	if len(statements) == 0 || statements[0].Kind != ast.KindExpressionStatement {
		return ""
	}
	call := statements[0].Expression()
	if call.Kind != ast.KindCallExpression || call.Flags&ast.NodeFlagsReparsed == 0 || !ast.IsIdentifier(call.Expression()) {
		return ""
	}
	switch call.Expression().Text() {
	case "$uninterruptibleBlock":
		return "uninterruptible"
	case "$restoreBlock":
		return "restore"
	case "$interruptibleBlock":
		return "interruptible"
	}
	return ""
}

// maskBlock lowers an interruption block (D179, D180) in an Effect body to
// its region under the prelude's function of the same name:
// `uninterruptible { body }` runs as `uninterruptible(program)`.
func (p *projector) maskBlock(node *ast.Node, word string, e env) {
	start := p.tokenStart(node)
	brace := scanner.SkipTrivia(p.text, start+len(word))
	closing := node.End() - 1
	if !strings.HasPrefix(p.text[start:], word) || brace >= len(p.text) || p.text[brace] != '{' || p.text[closing] != '}' {
		p.unprojected(node)
		return
	}
	r := &region{tail: isTailRegion(node, e), labeled: node.Parent != nil && node.Parent.Kind == ast.KindLabeledStatement}
	name := p.freshCompletion()
	body := node.Statements()[1:]
	p.visitList(body, regionEnv(r, e))
	normal := canCompleteNormally(body)
	if normal && len(r.jumps) > 0 && !r.tail {
		p.plan.markText(editRecord, partWhole, closing, closing, "; return "+helperRef("$end")+" ")
	}
	p.plan.markText(editRegion, partOpen, start, brace, openRegion(r, name)+p.names.prelude(word)+"("+p.generatorOpen(node))
	p.plan.markText(editRegion, partClose, node.End(), node.End(), p.generatorClose(node)+")")
	p.plan.markText(editDispatch, partWhole, node.End(), node.End(), p.dispatch(r, name, normal, e))
}

// exitBinding returns the name a `finally (exit)` block binds (D178): the
// parser writes `const exit = $exit()` as the block's first statement.
func exitBinding(finally *ast.Node) *ast.Node {
	statements := finally.Statements()
	if len(statements) == 0 || statements[0].Kind != ast.KindVariableStatement {
		return nil
	}
	declarations := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 {
		return nil
	}
	init := declarations[0].Initializer()
	if init == nil || init.Kind != ast.KindCallExpression || init.Flags&ast.NodeFlagsReparsed == 0 ||
		!ast.IsIdentifier(init.Expression()) || init.Expression().Text() != "$exit" {
		return nil
	}
	return declarations[0].Name()
}

// scopeBlock lowers a block of an Effect body whose own statements hold a
// using declaration or a fork the block owns (D14, D19) to a region of its
// own under $scopedBody, Effect.scoped at run time: the block's Scope holds
// its acquisitions and fibers, which it releases when the block ends, and a
// return, break, or continue that leaves it completes the region. In types
// $scopedBody is the identity, since $acquire and $scoped already remove
// Scope from what they add to R.
func (p *projector) scopeBlock(node *ast.Node, e env) {
	start := p.tokenStart(node)
	closing := node.End() - 1
	if start >= len(p.text) || p.text[start] != '{' || p.text[closing] != '}' {
		p.visitList(node.Statements(), e)
		return
	}
	r := &region{tail: isTailRegion(node, e), labeled: node.Parent != nil && node.Parent.Kind == ast.KindLabeledStatement}
	name := p.freshCompletion()
	opening := p.plan.reserve(editScopeRegion, partOpen, start, start)
	statements := node.Statements()
	p.visitList(statements, regionEnv(r, e))
	// A tail resume also leaves the cleanup region. Dispatch its completion
	// alongside explicit returns and loop jumps: discarding it invents a
	// clause fallthrough, while an unconditional return would skip a jump.
	if e.continuation != "" && endsInTailResume(node) {
		r.add(jump{kind: ast.KindReturnStatement})
	}
	normal := canCompleteNormally(statements)
	if normal && len(r.jumps) > 0 && !r.tail {
		p.plan.markText(editRecord, partWhole, closing, closing, "; return "+helperRef("$end")+" ")
	}
	p.plan.edits[opening].text = openRegion(r, name) + helperRef("$scopedBody") + "(" + helperRef("$gen") + "(" + selfPrefix(node) + "function* () "
	p.plan.markText(editScopeRegion, partClose, node.End(), node.End(), "))")
	p.plan.markText(editDispatch, partWhole, node.End(), node.End(), p.dispatch(r, name, normal, e))
}

// scopeLoopStatement lowers node, a loop body that is not a block and owns
// a fork, to the region of one iteration (D408), as scopeBlock lowers a
// block body: `for (const x of xs) fork work(x)` is
// `for (const x of xs) { fork work(x) }`.
func (p *projector) scopeLoopStatement(node *ast.Node, e env) {
	start := p.tokenStart(node)
	r := &region{tail: isTailRegion(node, e)}
	name := p.freshCompletion()
	p.plan.insert(start, "{ ")
	opening := p.plan.reserve(editScopeRegion, partOpen, start, start)
	statements := []*ast.Node{node}
	saved := p.loopRegion
	p.loopRegion = node
	p.visitList(statements, regionEnv(r, e))
	p.loopRegion = saved
	normal := canCompleteNormally(statements)
	if normal && len(r.jumps) > 0 && !r.tail {
		p.plan.markText(editRecord, partWhole, node.End(), node.End(), "; return "+helperRef("$end")+" ")
	}
	p.plan.edits[opening].text = openRegion(r, name) + helperRef("$scopedBody") + "(" + helperRef("$gen") + "(" + selfPrefix(node) + "function* () { "
	p.plan.markText(editScopeRegion, partClose, node.End(), node.End(), " }))")
	p.plan.markText(editDispatch, partWhole, node.End(), node.End(), p.dispatch(r, name, normal, e))
	p.plan.insert(node.End(), " }")
}

// isLoopStatementRegion reports whether node is a loop body that is not a
// block and owns a fork or a using, so scopeLoopStatement lowers it.
func (p *projector) isLoopStatementRegion(node *ast.Node) bool {
	parent := node.Parent
	return node.Kind != ast.KindBlock && parent != nil && ast.IsIterationStatement(parent, false /*lookInLabeledStatements*/) &&
		parent.Statement() == node && p.holdsScopeIn(node)
}

// selfPrefix returns the self option of a block's generator, which passes
// this in when the block refers to it, or "".
func selfPrefix(block *ast.Node) string {
	if usesThis(block) {
		return "{ self: this }, "
	}
	return ""
}

// holdsScope reports whether statements, a region's own, hold a using
// declaration or a call of the prelude's fork that the region owns: one
// outside the functions and the regions nested in them (D408). A block that
// is only braces, such as an if branch, owns nothing, so its forks are the
// region's, and so are those of a do block, a match expression, and a catch
// expression's sides, which run where they stand.
func (p *projector) holdsScope(statements []*ast.Node) bool {
	for _, statement := range statements {
		if p.holdsScopeFrom(statement, nil) {
			return true
		}
	}
	return false
}

// holdsScopeIn reports whether root, a region's whole body that is not a
// block, such as an arrow's expression body or a loop body without braces,
// holds a using declaration or a fork the region owns.
func (p *projector) holdsScopeIn(root *ast.Node) bool {
	return p.holdsScopeFrom(root, root)
}

// holdsScopeFrom reports whether node, code of a region, holds a using
// declaration or a fork the region owns, outside the functions and the
// regions nested in it other than root.
func (p *projector) holdsScopeFrom(node *ast.Node, root *ast.Node) bool {
	found := false
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case found:
			return true
		case isUsingDeclaration(node):
			found = true
			return true
		case ast.IsFunctionLike(node) && !isRegionTransparent(node), ast.IsClassLike(node), node != root && ownsForks(node):
			return false
		case node.Kind == ast.KindCallExpression && p.isPreludeForkCall(node):
			found = true
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(node)
}

// ownsForks reports whether node, nested in a region, is a region of its own
// (D408): a loop body, with or without braces, a try, catch, or finally
// block, a block that declares using, or a provide or mask block.
func ownsForks(node *ast.Node) bool {
	parent := node.Parent
	switch {
	case parent == nil:
		return false
	case ast.IsIterationStatement(parent, false /*lookInLabeledStatements*/):
		return parent.Statement() == node
	case node.Kind != ast.KindBlock:
		return false
	case parent.Kind == ast.KindTryStatement, parent.Kind == ast.KindCatchClause:
		return true
	case isProvideBlock(node), maskWord(node) != "":
		return true
	}
	for _, statement := range node.Statements() {
		if isUsingDeclaration(statement) {
			return true
		}
	}
	return false
}

// isRegionTransparent reports whether fn, an arrow function the parser
// wrote, holds code of the region around it: a do block's function and a
// match expression's, which are called where they stand, and a catch
// expression's sides (D408).
func isRegionTransparent(fn *ast.Node) bool {
	if fn.Kind != ast.KindArrowFunction || fn.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed == 0 || fn.Parent == nil {
		return false
	}
	parent := fn.Parent
	if ast.IsParenthesizedExpression(parent) && parent.Parent != nil && ast.IsCallExpression(parent.Parent) && parent.Parent.Expression() == parent {
		return true
	}
	if !ast.IsCallExpression(parent) {
		return false
	}
	callee := parent.Expression()
	return ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$catchExpression"
}

// endsInTailResume reports that the last path through a cleanup block resumes.
// Earlier returns and loop jumps are collected by its region; the final resume
// must leave that region too, after the resumed continuation and cleanup run.
func endsInTailResume(node *ast.Node) bool {
	if isTailResume(node) {
		return true
	}
	switch node.Kind {
	case ast.KindBlock:
		statements := node.Statements()
		return len(statements) > 0 && endsInTailResume(statements[len(statements)-1])
	case ast.KindIfStatement:
		s := node.AsIfStatement()
		return s.ElseStatement != nil && endsInTailResume(s.ThenStatement) && endsInTailResume(s.ElseStatement)
	}
	return false
}

// omittedClauseBindings keeps the continuation after every argument of a
// locally declared operation. Only a fixed written arity can supply padding;
// imported and variadic operations keep the executable's last-argument rule.
func (p *projector) omittedClauseBindings(control, member *ast.Node, bound int) string {
	resolver, ok := p.forms.(*Resolver)
	if !ok || !ast.IsIdentifier(control) {
		return ""
	}
	service := resolver.serviceClassOf(control)
	if service == nil {
		return ""
	}
	for _, method := range service.Members() {
		if !ast.IsMethodDeclaration(method) || method.Name() == nil || method.Name().Text() != member.Text() {
			continue
		}
		for _, parameter := range method.Parameters() {
			if parameter.AsParameterDeclaration().DotDotDotToken != nil {
				return ""
			}
		}
		padding := ""
		for n := bound; n < len(method.Parameters()); n++ {
			padding += ", " + p.freshWord("$ignored"+strconv.Itoa(n))
		}
		return padding
	}
	return ""
}
