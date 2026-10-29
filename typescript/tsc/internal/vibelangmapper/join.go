package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
)

// isFiberHelper recognizes parser-generated calls without claiming written
// calls whose names happen to match the fiber helpers.
func isFiberHelper(node *ast.Node, name string, arity int) bool {
	return ast.IsCallExpression(node) && len(node.Arguments()) == arity &&
		ast.IsIdentifier(node.Expression()) && node.Expression().Flags&ast.NodeFlagsReparsed != 0 && node.Expression().Text() == name
}

// join runs the runtime's shape-preserving join at the source position.
// Validation is deliberately textual: unknown values need an annotation,
// since $join's never-valued fallback cannot diagnose an invalid operand.
func (p *projector) join(call *ast.Node, e env) {
	if _, hatch := p.forms.(*Resolver).inHatch(call); hatch {
		p.fiberDiagnostic(call, 4612, "join is VibeLang syntax, but a hatch body is plain TypeScript. Move the join out of the hatch.")
		return
	}
	if !e.effect {
		p.awaitChoice(call, "A join must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
	operand := call.Arguments()[0]
	valid, known := p.joinValue(operand, 0, 0)
	if !known {
		p.awaitChoice(operand, "The mapper cannot determine whether this join operand holds fibers. Add an explicit Fiber annotation, or an array or object annotation with Fiber elements.")
	} else if !valid {
		p.fiberDiagnostic(operand, 4611, "join takes a Fiber or a one-level array or object of fibers. Annotate the operand with Fiber elements; nest joins for deeper collections.")
	}
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	p.plan.replace(start, p.tokenStart(operand), helperRef("$join")+"(")
	p.visit(operand, e)
	p.plan.insert(call.End(), ")")
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
}

// fiberDiagnostic reports a fiber rule at its source span in both renderings.
func (p *projector) fiberDiagnostic(at *ast.Node, code int32, message string) {
	start := p.tokenStart(at)
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: max(0, at.End()-start), Code: code, Message: message})
}

// joinValue follows lexical initializers and annotations, allowing containers
// only at the outer level (D228). Recursion through aliases is bounded.
func (p *projector) joinValue(n *ast.Node, level, depth int) (valid, known bool) {
	if n == nil || depth > 16 {
		return false, false
	}
	r := p.forms.(*Resolver)
	n = ast.SkipParentheses(n)
	switch n.Kind {
	case ast.KindAsExpression, ast.KindSatisfiesExpression:
		return p.joinType(n.Type(), level, depth+1)
	case ast.KindNonNullExpression:
		return p.joinValue(n.Expression(), level, depth+1)
	case ast.KindIdentifier:
		if d := r.binding(n, n.Text()); d != nil {
			if d.Type() != nil {
				return p.joinType(d.Type(), level, depth+1)
			}
			if ast.IsIdentifier(d.Name()) && d.Name().Text() == n.Text() {
				return p.joinValue(d.Initializer(), level, depth+1)
			}
		}
		return false, false
	case ast.KindArrayLiteralExpression, ast.KindObjectLiteralExpression:
		if level > 0 {
			return false, true
		}
		var elements []*ast.Node
		if n.Kind == ast.KindObjectLiteralExpression {
			elements = n.Properties()
		} else {
			elements = n.Elements()
		}
		valid, known = n.Kind != ast.KindObjectLiteralExpression || len(elements) > 0, true
		for _, element := range elements {
			v := element
			if element.Kind == ast.KindPropertyAssignment {
				v = element.Initializer()
			}
			if element.Kind == ast.KindShorthandPropertyAssignment {
				v = element.Name()
			}
			if element.Kind == ast.KindSpreadElement || element.Kind == ast.KindSpreadAssignment {
				return false, false
			}
			ok, certain := p.joinValue(v, level+1, depth+1)
			valid, known = valid && ok, known && certain
		}
		return
	case ast.KindCallExpression:
		if r.receiverModule(n, 0) == "effect/Fiber" {
			return true, true
		}
		if ast.IsIdentifier(n.Expression()) {
			name := n.Expression().Text()
			if r.binding(n.Expression(), name) == nil && (name == "fork" || name == "detach" || name == "forkIn") {
				return true, true
			}
			if d := r.binding(n.Expression(), name); d != nil && ast.IsFunctionLike(d) && d.Type() != nil {
				t := formsUnwrapType(d.Type())
				if r.isEffectTypeNode(t, 0) {
					if len(t.TypeArguments()) == 0 {
						return false, false
					}
					t = t.TypeArguments()[0]
				}
				return p.joinType(t, level, depth+1)
			}
		}
		return false, false
	}
	if ast.IsLiteralKind(n.Kind) || n.Kind == ast.KindTrueKeyword || n.Kind == ast.KindFalseKeyword || n.Kind == ast.KindNullKeyword || isLambda(n) {
		return false, true
	}
	return false, false
}

// joinType validates written Fiber leaves, unions, and one outer container;
// any, unknown, unresolved names, and generic shapes require source evidence.
func (p *projector) joinType(t *ast.Node, level, depth int) (valid, known bool) {
	t = formsUnwrapType(t)
	if t == nil || depth > 16 {
		return false, false
	}
	r := p.forms.(*Resolver)
	if r.typeModuleOf(t) == "effect/Fiber" {
		return true, true
	}
	if t.Kind == ast.KindAnyKeyword || t.Kind == ast.KindUnknownKeyword {
		return false, false
	}
	if t.Kind == ast.KindUnionType {
		valid, known = true, true
		for _, member := range t.AsUnionTypeNode().Types.Nodes {
			v, k := p.joinType(member, level, depth+1)
			valid, known = valid && v, known && k
		}
		return
	}
	if t.Kind == ast.KindTypeReference {
		if alias := r.localType(t); alias != nil {
			if alias.Kind == ast.KindTypeAliasDeclaration {
				return p.joinType(alias.Type(), level, depth+1)
			}
			t = alias
		}
	}
	if level == 0 {
		if elem := formsElementType(t); elem != nil {
			return p.joinType(elem, 1, depth+1)
		}
		if t.Kind == ast.KindTupleType {
			valid, known = true, true
			for _, elem := range t.AsTupleTypeNode().Elements.Nodes {
				v, k := p.joinType(elem, 1, depth+1)
				valid, known = valid && v, known && k
			}
			return
		}
		if t.Kind == ast.KindTypeLiteral || t.Kind == ast.KindInterfaceDeclaration {
			valid, known = len(t.Members()) > 0, true
			for _, member := range t.Members() {
				v, k := p.joinType(member.Type(), 1, depth+1)
				valid, known = valid && v, known && k
			}
			return
		}
	}
	if t.Kind == ast.KindTypeReference && r.typeModuleOf(t) == "" {
		return false, false
	}
	return false, true
}

// tryValue runs the Effect p of try p, which the parser writes as $try(p)
// before anything but a call, at the source position (VIP-5). Before a call,
// try is the call itself, whose keyword visit removes.
func (p *projector) tryValue(call *ast.Node, e env) {
	if !e.effect {
		p.awaitChoice(call, "A try must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
	operand := call.Arguments()[0]
	start := p.tokenStart(call)
	if p.statementStarts[start] {
		p.plan.insert(start, ";")
		delete(p.statementStarts, start)
	}
	p.plan.mark(editRun, partOpen, start, start, "")
	p.plan.replace(start, p.tokenStart(operand), helperRef("$try")+"(")
	p.visit(operand, e)
	p.plan.insert(call.End(), ")")
	p.plan.mark(editRun, partClose, call.End(), call.End(), "")
}

// triedKeywords returns the offset of the try of each call the parser
// flagged NodeFlagsVibeLangTry. try f() means f() where the call runs
// (VIP-5), so lower projects the program with each such try blanked.
func triedKeywords(file *ast.SourceFile, text string) []int {
	var keywords []int
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsVibeLangTry != 0 {
			keywords = append(keywords, scanner.SkipTrivia(text, node.Pos()))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return keywords
}

// blank returns text with the try at each of keywords written as spaces,
// which keep every position.
func blank(text string, keywords []int) string {
	b := []byte(text)
	for _, at := range keywords {
		copy(b[at:at+len("try")], "   ")
	}
	return string(b)
}

// withoutTries returns segments without the blanked try keywords: a verbatim
// segment that holds one is split around it, so the spaces that stand for
// the keyword map to no original text, and every verbatim segment still
// matches the original text.
func withoutTries(segments []spanmap.Segment, keywords []int) []spanmap.Segment {
	if len(keywords) == 0 {
		return segments
	}
	var out []spanmap.Segment
	for _, segment := range segments {
		if segment.Kind != spanmap.KindVerbatim {
			out = append(out, segment)
			continue
		}
		for _, at := range keywords {
			start, end := core.TextPos(at), core.TextPos(at+len("try"))
			if start < segment.OriginalStart || end > segment.OriginalEnd {
				continue
			}
			if start > segment.OriginalStart {
				before := segment
				before.OriginalEnd = start
				before.VirtualEnd = segment.VirtualStart + (start - segment.OriginalStart)
				out = append(out, before)
			}
			segment.VirtualStart += end - segment.OriginalStart
			segment.OriginalStart = end
		}
		if segment.OriginalEnd > segment.OriginalStart {
			out = append(out, segment)
		}
	}
	return out
}
