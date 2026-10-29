package vibelangmapper

import (
	"encoding/json"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Synthesized forms. Some VibeLang forms parse into TypeScript that is not
// their source text: a match expression is an if chain in a function called
// where it stands, and an is pattern is a test (internal/parser/
// vibelang_match.go). Such a form's tree mixes synthesized nodes with source
// nodes the parser reuses: the match's subject, each arm's value, a
// pattern's literals, values, and binding names. The projection prints the
// synthesized nodes as text and walks each source subtree in place, with
// every other rule, so a call in an arm's value runs and a hover on it lands
// on its own text. A source subtree the form uses out of source order, such
// as a binding name a pattern names before a test, is written as a copy.

// chunk is one piece of a synthesized form's output: text of kind, or a
// source subtree to walk in place in env.
type chunk struct {
	fields []string
	kind   editKind
	part   part
	text   string
	node   *ast.Node
	env    env
}

// printer collects a synthesized form's chunks.
type printer struct {
	p      *projector
	chunks []chunk
	// names maps the parser's temporaries ($match1, $is2) to fresh names.
	names         map[string]string
	rawExtraction bool // printing the executable side of an extractor witness
	// captures maps each capture of the form whose subject is an identifier
	// expression to that subject (captures.go).
	captures map[string]*ast.Node
	// runtimeText makes patternText write the executable side of a chunk
	// that the renderings write differently.
	runtimeText bool
}

func (w *printer) write(text string) {
	w.chunks = append(w.chunks, chunk{kind: editSyntax, text: text})
}

func (w *printer) mark(kind editKind, p part, text string) {
	w.chunks = append(w.chunks, chunk{kind: kind, part: p, text: text})
}

// synthesized prints node, a synthesized form that stands for the source
// text in [start, end), as edits: text before each in-order source subtree
// replaces the source text up to it, and the rest replaces what follows the
// last one.
func (p *projector) synthesized(node *ast.Node, start, end int, e env) {
	w := &printer{p: p, names: map[string]string{}}
	w.node(node, e)
	cursor := start
	pending := []chunk{}
	flush := func(to int) {
		for i, c := range pending {
			from := to
			if i == 0 {
				from = cursor
			}
			if c.fields != nil {
				p.plan.markFields(c.kind, c.part, from, to, c.fields...)
			} else {
				p.plan.markText(c.kind, c.part, from, to, c.text)
			}
		}
		if len(pending) == 0 && to > cursor {
			p.plan.replace(cursor, to, "")
		}
		pending = pending[:0]
	}
	for _, c := range w.chunks {
		if c.node == nil {
			pending = append(pending, c)
			continue
		}
		s := p.tokenStart(c.node)
		if s >= cursor && c.node.End() <= end {
			flush(s)
			p.visit(c.node, c.env)
			cursor = c.node.End()
			continue
		}
		// Out of order: a copy of the source text.
		pending = append(pending, chunk{kind: editSyntax, text: p.text[s:c.node.End()]})
	}
	flush(end)
}

// node prints n: a source subtree as itself, anything else from its parts.
func (w *printer) node(n *ast.Node, e env) {
	p := w.p
	if n == nil {
		return
	}
	if !w.rawExtraction && w.errorExtractorFlow(n, e) {
		return
	}
	// These forms have source spans but synthesized descendants. Let their
	// own lowering preserve lazy operands and lexical pipe topics, including
	// when a match arm or do expression contains them.
	if isCatchExpression(n) || isFiberHelper(n, "$join", 1) || isFiberHelper(n, "$try", 1) ||
		isPipeExpression(n) || formsIsTopic(n) || p.isSource(n) ||
		ast.IsCallExpression(n) && isRunnableCall(n) && p.isSource(n.Expression()) {
		// A source call with synthesized arguments still needs the normal
		// call walker: exit(x catch y), for example, takes its operand by
		// name and must run the call itself before a match inspects its value.
		w.chunks = append(w.chunks, chunk{node: n, env: e})
		return
	}
	switch n.Kind {
	case ast.KindIdentifier:
		if w.captureRead(n, e) {
			return
		}
		w.write(w.identifier(n))
	case ast.KindStringLiteral:
		quoted, _ := json.Marshal(n.Text())
		w.write(string(quoted))
	case ast.KindNumericLiteral, ast.KindBigIntLiteral:
		w.write(n.Text())
	case ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword, ast.KindThisKeyword, ast.KindUndefinedKeyword:
		w.write(scanner.TokenToString(n.Kind))
	case ast.KindPropertyAccessExpression:
		w.node(n.Expression(), e)
		if n.QuestionDotToken() != nil {
			w.write("?.")
		} else {
			w.write(".")
		}
		w.write(n.Name().Text())
	case ast.KindElementAccessExpression:
		w.node(n.Expression(), e)
		w.write("[")
		w.node(n.AsElementAccessExpression().ArgumentExpression, e)
		w.write("]")
	case ast.KindCallExpression:
		if w.invokedBlock(n, e) || w.isFunction(n) || w.builtinTest(n, e) {
			return
		}
		w.node(n.Expression(), e)
		w.write("(")
		w.list(n.Arguments(), ", ", e)
		w.write(")")
	case ast.KindBinaryExpression:
		if w.tagTest(n, e) {
			return
		}
		b := n.AsBinaryExpression()
		w.node(b.Left, e)
		w.write(" " + scanner.TokenToString(b.OperatorToken.Kind) + " ")
		w.node(b.Right, e)
	case ast.KindPrefixUnaryExpression:
		u := n.AsPrefixUnaryExpression()
		w.write(scanner.TokenToString(u.Operator))
		w.node(u.Operand, e)
	case ast.KindTypeOfExpression:
		w.write("typeof ")
		w.node(n.Expression(), e)
	case ast.KindParenthesizedExpression:
		w.write("(")
		w.node(n.Expression(), e)
		w.write(")")
	case ast.KindConditionalExpression:
		c := n.AsConditionalExpression()
		w.node(c.Condition, e)
		w.write(" ? ")
		w.node(c.WhenTrue, e)
		w.write(" : ")
		w.node(c.WhenFalse, e)
	case ast.KindArrayLiteralExpression:
		w.write("[")
		w.list(n.Elements(), ", ", e)
		w.write("]")
	case ast.KindSpreadElement:
		w.write("...")
		w.node(n.Expression(), e)
	case ast.KindArrowFunction:
		w.write("(")
		w.list(n.Parameters(), ", ", e)
		w.write(") => ")
		inner := env{}
		w.node(n.Body(), inner)
	case ast.KindParameter:
		w.node(n.Name(), e)
	case ast.KindBlock:
		w.write("{ ")
		for _, statement := range n.Statements() {
			w.statement(statement, e)
		}
		w.write("}")
	default:
		if ast.IsStatement(n) {
			w.statement(n, e)
			return
		}
		// A node of a kind no form writes: its source text as it stands.
		w.chunks = append(w.chunks, chunk{node: n, env: e})
	}
}

// statement prints a statement followed by its separator.
func (w *printer) statement(n *ast.Node, e env) {
	p := w.p
	if p.isSource(n) || n.Kind == ast.KindExpressionStatement && isFiberHelper(n.Expression(), "$forConcurrent", 3) {
		w.chunks = append(w.chunks, chunk{node: n, env: e})
		w.write("; ")
		return
	}
	switch n.Kind {
	case ast.KindBlock:
		w.node(n, e)
		w.write(" ")
	case ast.KindIfStatement:
		s := n.AsIfStatement()
		w.write("if (")
		w.node(s.Expression, e)
		w.write(") ")
		w.statement(s.ThenStatement, e)
		if s.ElseStatement != nil {
			w.write("else ")
			w.statement(s.ElseStatement, e)
		}
	case ast.KindReturnStatement:
		w.returnStatement(n, e)
	case ast.KindExpressionStatement:
		w.node(n.Expression(), e)
		w.write("; ")
	case ast.KindVariableStatement:
		if w.captureDeclaration(n, e) {
			return
		}
		list := n.AsVariableStatement().DeclarationList
		keyword := "var "
		switch {
		case list.Flags&ast.NodeFlagsConst != 0:
			keyword = "const "
		case list.Flags&ast.NodeFlagsLet != 0:
			keyword = "let "
		}
		w.write(keyword)
		for i, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
			if i > 0 {
				w.write(", ")
			}
			w.node(declaration.Name(), e)
			if init := declaration.Initializer(); init != nil {
				w.write(" = ")
				w.node(init, e)
			}
		}
		w.write("; ")
	case ast.KindLabeledStatement:
		s := n.AsLabeledStatement()
		label := w.temporary(s.Label.Text())
		w.write(label + ": ")
		if e.effect {
			e.frame.targets = append(e.frame.targets, target{label: s.Label.Text()})
			w.statement(s.Statement, e)
			e.frame.targets = e.frame.targets[:len(e.frame.targets)-1]
		} else {
			w.statement(s.Statement, e)
		}
	case ast.KindBreakStatement, ast.KindContinueStatement:
		w.jump(n, e)
	case ast.KindWhileStatement:
		w.write("while (")
		w.node(n.Expression(), e)
		w.write(") ")
		if e.effect {
			e.frame.targets = append(e.frame.targets, target{loop: true})
			w.statement(n.Statement(), e)
			e.frame.targets = e.frame.targets[:len(e.frame.targets)-1]
		} else {
			w.statement(n.Statement(), e)
		}
	default:
		w.chunks = append(w.chunks, chunk{node: n, env: e})
		w.write("; ")
	}
}

// returnStatement prints a return the parser wrote, such as an arm's: in a
// region's block, its value is boxed as a written return's is (regions.go).
func (w *printer) returnStatement(n *ast.Node, e env) {
	expression := n.Expression()
	if e.effect && e.frame.region != nil {
		e.frame.region.add(jump{kind: ast.KindReturnStatement})
		if expression == nil {
			w.write("return; ")
			return
		}
		w.mark(editRecord, partOpen, "return "+helperRef("$box")+"(")
		w.node(expression, e)
		w.mark(editRecord, partClose, "); ")
		return
	}
	w.write("return ")
	if expression != nil {
		w.node(expression, e)
	}
	w.write("; ")
}

// jump prints a break or continue the parser wrote; one that leaves a
// region completes it, as a written one does.
func (w *printer) jump(n *ast.Node, e env) {
	j := jump{kind: n.Kind}
	label := ""
	if l := n.Label(); l != nil {
		j.label = l.Text()
		label = " " + w.temporary(l.Text())
	}
	if e.effect && e.frame.region != nil && !e.frame.lands(j) {
		e.frame.region.add(j)
		w.mark(editRecord, partWhole, "return "+helperRef("$jump")+"("+jsonString(jumpKind(j))+"); ")
		return
	}
	keyword := "break"
	if n.Kind == ast.KindContinueStatement {
		keyword = "continue"
	}
	w.write(keyword + label + "; ")
}

// invokedBlock prints (() => { ... })(), the function a match expression, a
// do expression, or a throw expression is called in, and reports whether n
// is one. In an Effect body it runs where it stands, as the fork's Effect
// function does: its generator is a program run at once, so the arms'
// values run and their failures join the function's.
func (w *printer) invokedBlock(n *ast.Node, e env) bool {
	callee := n.Expression()
	if len(n.Arguments()) != 0 || callee.Kind != ast.KindParenthesizedExpression {
		return false
	}
	arrow := callee.Expression()
	if arrow.Kind != ast.KindArrowFunction || len(arrow.Parameters()) != 0 || arrow.Body().Kind != ast.KindBlock {
		return false
	}
	if !e.effect {
		w.write("(() => ")
		w.node(arrow.Body(), env{})
		w.write(")()")
		return true
	}
	w.mark(editRun, partOpen, "")
	w.mark(editProgram, partOpen, "")
	inner := newEffectEnv()
	inner.continuation = e.continuation
	w.node(arrow.Body(), inner)
	w.mark(editProgram, partClose, "")
	w.mark(editRun, partClose, "")
	return true
}

// list prints nodes separated by separator.
func (w *printer) list(nodes []*ast.Node, separator string, e env) {
	for i, n := range nodes {
		if i > 0 {
			w.write(separator)
		}
		w.node(n, e)
	}
}

// builtinTest prints n when it is a pattern's $is call whose matcher names a
// built-in matcher (parser.BuiltinMatchers), as the test the compiler writes
// for it: typeof subject === "string", or Option.isNone(subject). The
// compiler writes that test only when the matcher resolves to the built-in
// (match_builtins.go in package vibelang); the projection has no checker, so
// it goes by the name as written.
func (w *printer) builtinTest(n *ast.Node, e env) bool {
	callee := n.Expression()
	if !ast.IsIdentifier(callee) || callee.Text() != "$is" || callee.Flags&ast.NodeFlagsReparsed == 0 || len(n.Arguments()) != 2 {
		return false
	}
	builtin, ok := parser.BuiltinMatcherNamed(n.Arguments()[0])
	if !ok {
		return false
	}
	if builtin.TypeOf != "" {
		w.write("typeof ")
		w.node(n.Arguments()[1], e)
		w.write(" === \"" + builtin.TypeOf + "\"")
		return true
	}
	module := builtin.Module
	if preludeNames[module] && !builtinGlobals[module] {
		module = w.p.names.prelude(module)
	}
	w.write(module + "." + builtin.Guard + "(")
	w.node(n.Arguments()[1], e)
	w.write(")")
	return true
}

// identifier returns the text of a synthesized identifier: a runtime helper
// the parser names ($is, $noMatch) through the prelude, a module the
// parser names (Option.isSome) as the prelude name or its alias, a
// temporary under a fresh name, and anything else, a copy of a source
// name, as written.
func (w *printer) identifier(n *ast.Node) string {
	name := n.Text()
	switch {
	case name == "$is" || name == "$noMatch" || name == "$extract" || name == "$rest" || name == "$patternError":
		return helperRef(name)
	case strings.HasPrefix(name, "$match") || strings.HasPrefix(name, "$is"):
		return w.temporary(name)
	case preludeNames[name] && !builtinGlobals[name]:
		return w.p.names.prelude(name)
	}
	return name
}

// temporary returns the fresh name of one of the parser's temporaries.
func (w *printer) temporary(name string) string {
	if !strings.HasPrefix(name, "$") {
		return name
	}
	if fresh, ok := w.names[name]; ok {
		return fresh
	}
	fresh := w.p.freshWord(name)
	w.names[name] = fresh
	return fresh
}

// startsWord reports whether text starts with word followed by a character
// that cannot continue it.
func startsWord(text, word string) bool {
	if !strings.HasPrefix(text, word) {
		return false
	}
	if len(text) == len(word) {
		return true
	}
	c := text[len(word)]
	return !(c == '_' || c == '$' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z')
}

// jsonString quotes text as a JavaScript string literal.
func jsonString(text string) string {
	quoted, _ := json.Marshal(text)
	return string(quoted)
}

// isSource reports whether n is a source subtree: a node the parser made
// from its own text, whose descendants are too. A synthesized node is
// flagged NodeFlagsReparsed; a node that only spans source nodes, such as
// an arm's if, is found by its text, which does not start with the node's
// own first token.
func (p *projector) isSource(n *ast.Node) bool {
	if known, ok := p.sources[n]; ok {
		return known
	}
	result := p.checkSource(n)
	p.sources[n] = result
	return result
}

func (p *projector) checkSource(n *ast.Node) bool {
	if n.Flags&ast.NodeFlagsReparsed != 0 || n.End() <= n.Pos() {
		return false
	}
	start := p.tokenStart(n)
	if start >= n.End() || start > len(p.text) {
		return false
	}
	at := func(word string) bool { return strings.HasPrefix(p.text[start:], word) }
	first := func(child *ast.Node) bool { return child != nil && p.tokenStart(child) == start }
	switch n.Kind {
	case ast.KindIdentifier:
		if p.text[start:n.End()] != n.Text() {
			return false
		}
	case ast.KindStringLiteral:
		if !at(`"`) && !at("'") {
			return false
		}
	case ast.KindBlock, ast.KindObjectLiteralExpression:
		if !at("{") {
			return false
		}
	case ast.KindParenthesizedExpression:
		if !at("(") {
			return false
		}
	case ast.KindArrayLiteralExpression:
		if !at("[") {
			return false
		}
	case ast.KindReturnStatement:
		if !at("return") {
			return false
		}
	case ast.KindIfStatement:
		if !at("if") {
			return false
		}
	case ast.KindWhileStatement:
		if !at("while") {
			return false
		}
	case ast.KindBreakStatement:
		if !at("break") {
			return false
		}
	case ast.KindContinueStatement:
		if !at("continue") {
			return false
		}
	case ast.KindThrowStatement:
		if !at("throw") {
			return false
		}
	case ast.KindForStatement, ast.KindForOfStatement, ast.KindForInStatement:
		if !at("for") {
			return false
		}
	case ast.KindDoStatement:
		if !at("do") {
			return false
		}
	case ast.KindSwitchStatement:
		if !at("switch") {
			return false
		}
	case ast.KindTryStatement:
		if !at("try") {
			return false
		}
	case ast.KindVariableStatement:
		if !at("const") && !at("let") && !at("var") && !at("using") && !at("await") && !at("export") && !at("declare") {
			return false
		}
	case ast.KindLabeledStatement:
		if n.AsLabeledStatement().Label.Flags&ast.NodeFlagsReparsed != 0 {
			return false
		}
	case ast.KindExpressionStatement:
		if !first(n.Expression()) {
			return false
		}
	case ast.KindCallExpression, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
		if !first(n.Expression()) {
			return false
		}
	case ast.KindBinaryExpression:
		if !first(n.AsBinaryExpression().Left) {
			return false
		}
	}
	ok := true
	previous := n.Pos()
	n.ForEachChild(func(child *ast.Node) bool {
		if child.Pos() < previous || child.End() > n.End() || !p.isSource(child) {
			ok = false
			return true
		}
		previous = child.End()
		return false
	})
	return ok
}

// isMatchForm reports whether node is a form the parser writes for match
// or is (vibelang_match.go) that the projection prints: a match expression's
// invoked function, a returned match's block, a match statement's labeled
// block, an is test, or an if or while an is with bindings restructured.
func (p *projector) isMatchForm(node *ast.Node) bool {
	if node.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	start := p.tokenStart(node)
	if start >= len(p.text) {
		return false
	}
	at := func(word string) bool { return strings.HasPrefix(p.text[start:], word) }
	switch node.Kind {
	case ast.KindCallExpression:
		// match (...) { ... }, do { ... }, throw x: an invoked function; or
		// x is P with a subject a parameter holds.
		callee := node.Expression()
		if callee.Kind != ast.KindParenthesizedExpression {
			return false
		}
		return startsWord(p.text[start:], "match") || startsWord(p.text[start:], "do") || startsWord(p.text[start:], "throw") ||
			!strings.HasPrefix(p.text[p.tokenStart(callee):], "(")
	case ast.KindParenthesizedExpression:
		return !at("(")
	case ast.KindBlock:
		return at("return") || at("if")
	case ast.KindLabeledStatement:
		return node.AsLabeledStatement().Label.Flags&ast.NodeFlagsReparsed != 0
	case ast.KindWhileStatement:
		return node.Expression().Flags&ast.NodeFlagsReparsed != 0
	}
	return false
}

// tagTest preserves a generated literal comparison as a type predicate
// (D209/D218/D238). Stock TypeScript excludes a singleton class in the
// predicate's false branch, whereas a property equality only excludes union
// constituents. Only parser-written accesses to an identifier qualify.
func (w *printer) tagTest(n *ast.Node, e env) bool {
	b := n.AsBinaryExpression()
	if b.OperatorToken.Kind != ast.KindEqualsEqualsEqualsToken ||
		!ast.IsPropertyAccessExpression(b.Left) || b.Left.Expression().Flags&ast.NodeFlagsReparsed == 0 ||
		b.Left.Name().Text() != "_tag" || !ast.IsIdentifier(b.Left.Expression()) ||
		b.Right.Kind != ast.KindStringLiteral {
		return false
	}
	subject := w.identifier(b.Left.Expression())
	value := w.p.freshWord("$tag")
	literal := jsonString(b.Right.Text())
	guard := func(subject string) string {
		return "((" + value + ": typeof " + subject + "): " + value + " is " + helperRef("$TagMatch") + "<typeof " + subject + ", " + literal + "> => " + value + "._tag === "
	}
	captured := w.captures[b.Left.Expression().Text()]
	if captured == nil {
		w.write(guard(subject))
		w.node(b.Right, e)
		w.write(")(" + subject + ")")
		return true
	}
	// A capture's test reads the subject itself when checking (captures.go).
	checking := w.patternText(captured, e)
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{guard(checking), guard(subject)}})
	w.node(b.Right, e)
	w.chunks = append(w.chunks, chunk{kind: editPatternFlow, part: partWhole, fields: []string{")(" + checking + ")", ")(" + subject + ")"}})
	return true
}
