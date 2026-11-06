package vibelangmapper

import (
	"cmp"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// forConcurrent reconstructs the parser's helper call. Evaluate a written
// limit before the items, in source order, and keep the item body lazy.
// Existing run/program edits supply both renderings' generator boundaries.
func (p *projector) forConcurrent(call *ast.Node, e env) {
	if !e.effect {
		p.formChoice(call, "for concurrent must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
	args := call.Arguments()
	items, limit, fn := args[0], args[1], args[2]
	loopBody := fn.Body()
	body := loopBody
	pattern, statements := concurrentHeadPattern(fn, body)
	// The synthetic body includes the head for editor lookup. Its inner
	// source body owns the edits; a head position can precede the iterable.
	if body.Pos() < items.End() && len(statements) == 1 {
		body = statements[0]
		if ast.IsBlock(body) {
			statements = body.Statements()
		} else {
			statements = []*ast.Node{body}
		}
	}
	bodyStart := p.tokenStart(body)
	if bodyStart >= len(p.text) {
		// An unfinished loop's synthetic body can start at EOF.
		p.unprojected(call)
		return
	}
	start := p.tokenStart(call.Parent)
	if call.Parent.Kind != ast.KindExpressionStatement {
		start = p.tokenStart(call)
	}
	delete(p.statementStarts, p.tokenStart(call))
	if isStatementListItem(call.Parent) {
		p.plan.insert(start, ";")
	}
	limitName := ""
	if limit.Flags&ast.NodeFlagsReparsed == 0 {
		limitName = p.names.fresh("$concurrency")
		p.plan.insert(start, "{ const "+limitName+" = ")
		p.concurrentCopy(limit, start, e)
		p.plan.insert(start, "; ")
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	p.plan.replace(start, p.tokenStart(items), p.names.prelude("Effect")+".forEach(")
	p.visit(items, e)
	at := items.End()
	p.plan.insert(at, ", (")
	p.concurrentCopy(pattern, at, env{})
	p.plan.insert(at, ") => ")
	p.plan.replace(at, p.tokenStart(body), "")
	continues := p.concurrentJumps(loopBody)
	p.plan.mark(editProgram, partOpen, p.tokenStart(body), p.tokenStart(body), selfArg(loopBody))
	// The parser gives an unbraced statement a synthetic block at the
	// statement's own span. Supply only those braces the source lacks.
	braced := p.text[bodyStart] == '{'
	bodyEdits := len(p.plan.edits)
	if !braced {
		// The synthetic block may hold is-binding declarations anchored in
		// the source pattern. Render it as a whole so their insertions cannot
		// overlap the replacement of that pattern.
		p.synthesizedBlock(loopBody, statements, bodyStart, body.End(), newEffectEnv())
	} else {
		p.visitList(statements, newEffectEnv())
	}
	// Record replacements after the body walk so region completion edits
	// at the same return position open before the keyword is consumed.
	for _, node := range continues {
		start := p.tokenStart(node)
		// A synthesized unbraced body may already have printed this
		// continue-return. Do not consume the same source span twice.
		if !braced && slices.ContainsFunc(p.plan.edits[bodyEdits:], func(ed edit) bool {
			return ed.pos <= start && ed.end >= node.End() && ed.end > ed.pos
		}) {
			continue
		}
		p.plan.replace(start, node.End(), "return")
	}
	p.plan.mark(editProgram, partClose, body.End(), body.End(), "")
	concurrency := `"unbounded"`
	if limitName != "" {
		concurrency = limitName
	}
	p.plan.insert(call.End(), ", { concurrency: "+concurrency+", discard: true })")
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
	if limitName != "" {
		p.plan.insert(call.End(), "; }")
	} else {
		p.plan.insert(call.End(), ";")
	}
}

// concurrentHeadPattern returns the head's binding and the body's own
// statements. A destructuring head binds inside the item: the parser passes
// the item as a synthesized $concurrentItem parameter and declares the
// pattern from it as the body's first statement, which the source lacks, so
// the pattern is what the helper argument shows and that statement is not
// projected.
func concurrentHeadPattern(fn, body *ast.Node) (*ast.Node, []*ast.Node) {
	name := fn.Parameters()[0].Name()
	statements := body.Statements()
	if name.Flags&ast.NodeFlagsReparsed == 0 || name.Kind != ast.KindIdentifier || len(statements) == 0 || statements[0].Kind != ast.KindVariableStatement {
		return name, statements
	}
	declarations := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 {
		return name, statements
	}
	initializer := declarations[0].AsVariableDeclaration().Initializer
	// The parser freshens generated names when source uses the same spelling.
	// Identify the generated item reference by its marker and binding instead.
	if initializer == nil || !ast.IsIdentifier(initializer) || initializer.Flags&ast.NodeFlagsVibeLangTemporary == 0 || initializer.Text() != name.Text() {
		return name, statements
	}
	return declarations[0].Name(), statements[1:]
}

// concurrentCopy moves a lowered header subtree to its helper argument.
// Replaying semantic edits, rather than rendered text, preserves both
// renderings, including temporaries and nested Effect calls in the limit.
func (p *projector) concurrentCopy(node *ast.Node, at int, e env) {
	first := len(p.plan.edits)
	p.visit(node, e)
	edits := slices.Clone(p.plan.edits[first:])
	p.plan.edits = p.plan.edits[:first]
	slices.SortStableFunc(edits, func(a, b edit) int { return cmp.Compare(a.pos, b.pos) })
	cursor := p.tokenStart(node)
	for _, ed := range edits {
		if ed.pos > cursor {
			p.plan.insert(at, p.text[cursor:ed.pos])
		}
		cursor = ed.end
		ed.pos, ed.end = at, at
		p.plan.edits = append(p.plan.edits, ed)
	}
	if cursor < node.End() {
		p.plan.insert(at, p.text[cursor:node.End()])
	}
}

// concurrentJumps restores the parser's continue returns and reports jumps
// that cannot leave an item fiber. Nested functions keep their own returns.
func (p *projector) concurrentJumps(body *ast.Node) (continues []*ast.Node) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsFunctionLike(node) || ast.IsClassLike(node):
			return false
		case node.Kind == ast.KindBreakStatement && node.Flags&ast.NodeFlagsVibeLang != 0:
			p.fiberDiagnostic(node, 1903, "break cannot leave a for concurrent loop: each item runs in its own fiber. Use continue to end this item, or throw to stop every item.")
		case node.Kind == ast.KindReturnStatement:
			if node.Flags&ast.NodeFlagsReparsed != 0 {
				continues = append(continues, node)
				// The source spelling is now normalized; ordinary return and
				// region completion handling can walk this parser-generated node.
				node.Flags &^= ast.NodeFlagsReparsed
			} else {
				p.fiberDiagnostic(node, 1904, "return cannot leave a for concurrent loop: each item runs in its own fiber. Use continue to end this item.")
			}
		}
		return node.ForEachChild(visit)
	}
	body.ForEachChild(visit)
	return continues
}
