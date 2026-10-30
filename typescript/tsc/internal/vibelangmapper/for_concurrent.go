package vibelangmapper

import (
	"cmp"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// forConcurrent reconstructs the parser's reordered helper call, keeping
// items and limit in their runtime argument order and the item body lazy.
// Existing run/program edits supply both renderings' generator boundaries.
func (p *projector) forConcurrent(call *ast.Node, e env) {
	if !e.effect {
		p.formChoice(call, "for concurrent must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
	args := call.Arguments()
	items, limit, fn := args[0], args[1], args[2]
	body := fn.Body()
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
	p.plan.mark(editRun, partOpen, start, start, "")
	p.plan.replace(start, p.tokenStart(items), helperRef("$forConcurrent")+"(")
	p.visit(items, e)
	at := items.End()
	p.plan.insert(at, ", ")
	if limit.Flags&ast.NodeFlagsReparsed != 0 {
		p.plan.insert(at, "undefined")
	} else {
		p.concurrentCopy(limit, at, e)
	}
	p.plan.insert(at, ", (")
	p.concurrentCopy(fn.Parameters()[0].Name(), at, env{})
	p.plan.insert(at, ") => ")
	p.plan.replace(at, p.tokenStart(body), "")
	continues := p.concurrentJumps(body)
	p.plan.mark(editProgram, partOpen, p.tokenStart(body), p.tokenStart(body), selfArg(body))
	// The parser gives an unbraced statement a synthetic block at the
	// statement's own span. Supply only those braces the source lacks.
	braced := p.text[bodyStart] == '{'
	if !braced {
		p.plan.insert(p.tokenStart(body), "{ ")
	}
	p.visitList(body.Statements(), newEffectEnv())
	// Record replacements after the body walk so region completion edits
	// at the same return position open before the keyword is consumed.
	for _, node := range continues {
		p.plan.replace(p.tokenStart(node), node.End(), "return")
	}
	if !braced {
		p.plan.insert(body.End(), " }")
	}
	p.plan.mark(editProgram, partClose, body.End(), body.End(), "")
	p.plan.insert(call.End(), ")")
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
	p.plan.insert(call.End(), ";")
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
			p.fiberDiagnostic(node, 4605, "break cannot leave a for concurrent loop: each item runs in its own fiber. Use continue to end this item, or throw to stop every item.")
		case node.Kind == ast.KindReturnStatement:
			if node.Flags&ast.NodeFlagsReparsed != 0 {
				continues = append(continues, node)
				// The source spelling is now normalized; ordinary return and
				// region completion handling can walk this parser-generated node.
				node.Flags &^= ast.NodeFlagsReparsed
			} else {
				p.fiberDiagnostic(node, 4606, "return cannot leave a for concurrent loop: each item runs in its own fiber. Use continue to end this item.")
			}
		}
		return node.ForEachChild(visit)
	}
	body.ForEachChild(visit)
	return continues
}
