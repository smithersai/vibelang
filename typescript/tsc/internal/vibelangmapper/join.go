package vibelangmapper

import (
	"cmp"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"slices"
	"strings"
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
		p.formChoice(call, "A join must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
	operand := call.Arguments()[0]
	valid, known := p.joinValue(operand, 0, 0)
	if !known {
		p.formChoice(operand, "The mapper cannot determine whether this join operand holds fibers. Add an explicit Fiber annotation, or an array or object annotation with Fiber elements.")
	} else if !valid {
		p.fiberDiagnostic(operand, 1704, "join cannot read a Fiber result from this operand. Annotate the operand with its Fiber type.")
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
		if isForkOwner(n) {
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
	operand := call.Arguments()[0]
	if !e.effect && p.ctx.Lint {
		p.plan.replace(p.tokenStart(call), p.tokenStart(operand), "")
		p.visit(operand, e)
		return
	}
	if !e.effect {
		p.formChoice(call, "A try must run in an Effect body; move it into an Effect function with an explicit contract.")
		return
	}
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

// keyword is a VibeLang keyword lower writes over before it walks the
// program: at is its offset, and with, as long as the keyword, is the text
// written there.
type keyword struct {
	at   int
	with string
}

// These declarations have no contextual lambda destination. Preserve their
// written kind separately from the resolver's lambda decisions (VIP-1).
type writtenEffectDeclarationMark [2]int

func isEffectDeclarationCandidate(n *ast.Node) bool {
	switch n.Kind {
	case ast.KindFunctionDeclaration:
		// VIP-21 producers retain their explicit effect kind across reparse too.
	case ast.KindMethodDeclaration:
		if !ast.IsClassLike(n.Parent) || n.AsMethodDeclaration().AsteriskToken != nil {
			return false
		}
	default:
		return false
	}
	return n.Body() != nil && n.ParameterList() != nil && n.Flags&ast.NodeFlagsReparsed == 0 && !ast.HasSyntacticModifier(n, ast.ModifierFlagsAsync)
}

func writtenEffectDeclarationMarks(file *ast.SourceFile) map[writtenEffectDeclarationMark]bool {
	marks := map[writtenEffectDeclarationMark]bool{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isEffectDeclarationCandidate(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
			marks[writtenEffectDeclarationMark{int(n.Kind), n.ParameterList().End()}] = true
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return marks
}

func restoreWrittenEffectDeclarationMarks(file *ast.SourceFile, marks map[writtenEffectDeclarationMark]bool) {
	if len(marks) == 0 {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isEffectDeclarationCandidate(n) && marks[writtenEffectDeclarationMark{int(n.Kind), n.ParameterList().End()}] {
			n.Flags |= ast.NodeFlagsVibeLangEffect
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
}

// vipKeywords returns the keywords of VIP-1, VIP-2 and VIP-5 that lower
// writes over. try f() means f() where the call runs (VIP-5), so the try of
// each call the parser flagged NodeFlagsVibeLangTry becomes spaces. effect
// before a function (VIP-1) becomes spaces too; written effect lambdas keep
// their kind through writtenEffectLambdaMarks, independently of the destination.
// effect { … } (VIP-2) is the program that () => { … } builds where an
// Effect is expected, and a return in it returns from the block, so its
// effect becomes ()=> and spaces. catch can follow the block but not an arrow,
// so a block that catch follows becomes (()=> { … }), the ) over the space
// after it.
func vipKeywords(file *ast.SourceFile, text string, lint bool) []keyword {
	var keywords []keyword
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Flags&ast.NodeFlagsVibeLangTry != 0 {
			keywords = append(keywords, keyword{scanner.SkipTrivia(text, node.Pos()), "   "})
		}
		if node.Flags&ast.NodeFlagsVibeLangEffect != 0 && ast.IsFunctionLike(node) {
			at := node.Pos()
			if modifiers := node.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
				at = modifiers.Nodes[len(modifiers.Nodes)-1].End()
			}
			at = scanner.SkipTrivia(text, at)
			if strings.HasPrefix(text[at:], "effect") {
				with := "      "
				// Removing effect exposes a generator method's star to the previous
				// class field's initializer. Keep the member boundary during reparse.
				if node.Kind == ast.KindMethodDeclaration && ast.IsClassLike(node.Parent) && node.BodyData().AsteriskToken != nil && (node.Modifiers() == nil || len(node.Modifiers().Nodes) == 0) {
					with = ";     "
				}
				if body := node.Body(); ast.IsArrowFunction(node) && body != nil && ast.IsBlock(body) && len(node.Parameters()) == 0 && scanner.SkipTrivia(text, at+len("effect")) == scanner.SkipTrivia(text, body.Pos()) {
					with = "()=>  " // effect { … }: the parser's arrow has no => of its own
					if lint {
						// try effect { … } reparses as a call of try on (), and a
						// linter does not need the run.
						if word := tryBefore(text, at); word >= 0 {
							keywords = append(keywords, keyword{word, "   "})
						}
					}
					if lint {
						// A statement guards against the line before it running on.
						// A block-bodied arrow ends at its }, so one continued by a
						// |>, .pipe or as needs parentheses; the ) writes over the
						// space after the block. }.pipe with no space stays text.
						statement := node.Parent != nil && node.Parent.Kind == ast.KindExpressionStatement
						end := body.End()
						switch continued := continuationFollows(text, end); {
						case continued && statement:
							with = ";(()=>"
						case continued:
							with = "(()=> "
						case statement:
							with = ";()=> "
						}
						if continuationFollows(text, end) {
							keywords = append(keywords, keyword{end, ")"})
						}
					} else if end := body.End(); catchFollows(text, end) {
						with = "(()=> "
						keywords = append(keywords, keyword{end, ")"})
					} else if word := tryOfBlock(text, node); word >= 0 {
						// try effect { … } reparses as a call of try on (), so
						// the word goes and tryBlockMarks keeps the run.
						keywords = append(keywords, keyword{word, tryBlockWord(node)})
					}
				}
				keywords = append(keywords, keyword{at, with})
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	slices.SortFunc(keywords, func(a, b keyword) int { return cmp.Compare(a.at, b.at) }) // withoutKeywords walks them in order
	return keywords
}

// continuationFollows reports whether a block's end at end is followed, past a
// space, a tab or a line break it can write over, by what continues an expression.
func continuationFollows(text string, end int) bool {
	if end >= len(text) || !strings.ContainsRune(" \t\r\n", rune(text[end])) {
		return false
	}
	rest := text[scanner.SkipTrivia(text, end):]
	for _, word := range []string{"|>", ".", "?.", "as ", "satisfies ", "catch"} {
		if strings.HasPrefix(rest, word) {
			return true
		}
	}
	return false
}

// tryBefore returns the position of the word try that ends just before at, or -1.
func tryBefore(text string, at int) int {
	before := strings.TrimRight(text[:at], " \t\r\n")
	if !strings.HasSuffix(before, "try") {
		return -1
	}
	word := len(before) - len("try")
	if word > 0 && scanner.IsIdentifierPart(rune(text[word-1])) {
		return -1
	}
	return word
}

// catchFollows reports whether a space or tab at end, the end of a block,
// comes before the word catch on the same line.
func catchFollows(text string, end int) bool {
	if end >= len(text) || text[end] != ' ' && text[end] != '\t' {
		return false
	}
	rest := strings.TrimLeft(text[end:], " \t")
	return strings.HasPrefix(rest, "catch") && (len(rest) == len("catch") || !scanner.IsIdentifierPart(rune(rest[len("catch")])))
}

// blank returns text with each of keywords written over, which keeps every
// position.
func blank(text string, keywords []keyword) string {
	b := []byte(text)
	for _, k := range keywords {
		copy(b[k.at:k.at+len(k.with)], k.with)
	}
	return string(b)
}

// withoutKeywords returns segments without the keywords lower wrote over: a
// verbatim segment that holds one is split around it, so the text that
// stands for the keyword maps to no original text, and every verbatim
// segment still matches the original text.
func withoutKeywords(segments []spanmap.Segment, keywords []keyword) []spanmap.Segment {
	if len(keywords) == 0 {
		return segments
	}
	var out []spanmap.Segment
	for _, segment := range segments {
		if segment.Kind != spanmap.KindVerbatim {
			out = append(out, segment)
			continue
		}
		for _, k := range keywords {
			start, end := core.TextPos(k.at), core.TextPos(k.at+len(k.with))
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

// A parameter-list end survives keyword blanking, including bare arrows
// and nested arrows whose bodies end at the same source position.
type writtenEffectLambdaMark [2]int

func effectLambdaMark(fn *ast.Node) writtenEffectLambdaMark {
	return writtenEffectLambdaMark{int(fn.Kind), fn.ParameterList().End()}
}

func writtenEffectLambdaMarks(file *ast.SourceFile) map[writtenEffectLambdaMark]bool {
	marks := map[writtenEffectLambdaMark]bool{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isLambda(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 && n.ParameterList() != nil {
			marks[effectLambdaMark(n)] = true
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return marks
}

func restoreWrittenEffectLambdaMarks(file *ast.SourceFile, marks map[writtenEffectLambdaMark]bool) {
	if len(marks) == 0 {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isLambda(n) && n.ParameterList() != nil && marks[effectLambdaMark(n)] {
			n.Flags |= ast.NodeFlagsVibeLangEffect
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
}

// Effect blocks have a synthetic arrow token rather than a written parameter
// list. Keep their body range through keyword blanking so the replacement arrow
// remains a program and retains the source execution boundary.
func effectBlockMark(file *ast.SourceFile, fn *ast.Node) [2]int {
	return [2]int{scanner.SkipTrivia(file.Text(), fn.Body().Pos()), fn.Body().End()}
}

func writtenEffectBlockMarks(file *ast.SourceFile) map[[2]int]bool {
	marks := map[[2]int]bool{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsArrowFunction(n) && sourceCatchProgramArrow(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 && n.Body() != nil && ast.IsBlock(n.Body()) {
			start := scanner.SkipTrivia(file.Text(), n.Pos())
			open := scanner.SkipTrivia(file.Text(), n.Body().Pos())
			if start+len("effect") <= len(file.Text()) && file.Text()[start:start+len("effect")] == "effect" && scanner.SkipTrivia(file.Text(), start+len("effect")) == open {
				marks[effectBlockMark(file, n)] = true
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return marks
}

func restoreWrittenEffectBlockMarks(file *ast.SourceFile, marks map[[2]int]bool) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsArrowFunction(n) && len(n.Parameters()) == 0 && n.Body() != nil && ast.IsBlock(n.Body()) && marks[effectBlockMark(file, n)] {
			n.Flags |= ast.NodeFlagsVibeLangEffect
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
}
