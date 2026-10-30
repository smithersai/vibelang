// Package vibelangfmt formats .vibe files with a TypeScript formatter.
//
// A .vibe file is TypeScript plus VibeLang's forms (D276). Format
// writes the file as TypeScript that keeps every VibeLang form's shape, has
// the TypeScript formatter format it, and writes the result back as VibeLang,
// so a .vibe file follows exactly the style its .ts neighbors follow.
//
// The TypeScript form of each VibeLang form is chosen so that the formatter
// lays it out as the form should look:
//
//	A!E!R, mutable x, try, %, a pattern    an identifier of the same width
//	f(args) { ... }, do { ... }, fork { }  f(args)(($v) => { ... })
//	effect { ... }                         $v(($v) => { ... })
//	effect function f(), effect m()        async function f(), async m()
//	effect f(), async f()                  async function f()
//	match (x) { when P: v; default: w; }   ({ $v1: x, $v2: v, default: w })
//	x catch y                              x.$v3(y)
//	x |> f(%)                              x || f($v4)
//	fork x, join x, throw x, await.all x   void x
//	x is P                                 x in $v5
//	provide X { }, uninterruptible { }     $v6: { }
//	error E { f: T }, schema S { f: T }    type $v7 = { f: T }
//	schema S = T                           type $v7 = T
//	data D { A; B { f: T } }               type $v7 = { A; B: { f: T } }
//	service S { m(): A!E }                 class $v8 { m(): $v9 }
//	service S: T, service S: T { static }  class $v8 {}, class $v8 { static }
//	for concurrent(n) (const x of xs)      for (const x of xs)
//	finally (exit) { }                     finally { }
//	try { } handle A.b(x) { } catch (e) { } try { } catch ($v10) { } $v11: { }
//	module text { ... }                    module text { ... }, the body formatted first
//	from text, import text                 from "./$vtext", import "./$vtext"
//
// $v stands for a prefix the file does not contain. Identifiers carry an
// index into a table of the text they stand for; the void, ||, for, and
// finally tokens are matched by their order, which a formatter keeps.
// A module declaration's body is TypeScript and holds no VibeLang forms;
// Format formats it as a .ts file of its own first (modules.go). Format
// checks that the result parses to the same program as the source, module
// bodies included, so a formatter that moves a token it should not fails the
// file instead of changing it.
package vibelangfmt

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// placeholderKind says what a placeholder identifier stands for, and so how
// decoding finds the tokens around it.
type placeholderKind int

const (
	placeholderText         placeholderKind = iota // the identifier is the text
	placeholderIsPattern                           // a pattern; the in before it is is
	placeholderMatchHead                           // the property that holds a match's subject
	placeholderMatchArm                            // when and a pattern, as an arm's property name
	placeholderBlockHead                           // a label for a block statement's header
	placeholderClauseHead                          // a label for a try clause after the first
	placeholderHandleHead                          // a catch variable for a handle clause
	placeholderTypeHead                            // a type alias name for an error or schema header
	placeholderClassHead                           // a class name for a service or control header
	placeholderCatch                               // a method name for catch
	placeholderMutableIndex                        // [ and the key name after mutable
)

type placeholder struct {
	kind placeholderKind
	// text is the source text the placeholder stands for.
	text string
	// indent is the indentation of the source line where text starts, so
	// text that spans lines can be indented as its new line is.
	indent string
	// noBody marks an error declaration written without fields or, for one
	// written as a class, without a body, and a service of any shape (D281)
	// written without a body.
	noBody bool
	// alias marks a schema alias, schema Name = Type (D280), whose = and type
	// the type alias keeps as written.
	alias bool
	// data marks a data declaration (D307), whose variants with fields the
	// type literal writes with a colon before the fields.
	data bool
	// nested marks a placeholder whose edit an opaque edit swallowed, such as
	// an Effect type in the shape of service Format: (s: string) => string!!:
	// the enclosing placeholder keeps its text, so decoding never sees it.
	nested bool
}

// edit replaces source[pos:end] with text. An edit with pos == end inserts.
type edit struct {
	pos, end int
	text     string
	// order sorts edits that start at the same position: insertions before
	// replacements, and among insertions the outer form's first.
	order int
	// opaque marks an edit whose replaced text is kept in a placeholder, so
	// comments in it survive and forms inside it are not edited.
	opaque bool
	// token is the void or || token the edit writes at the start of text,
	// or the for or finally keyword at keyword whose following text the edit
	// removes, and stands is what the token stands for or the removed text.
	token   string
	keyword int
	stands  string
	// seq is the order the edit was made in: an inner form's edits come
	// before its enclosing form's.
	seq int
}

// encoding is a .vibe file written as TypeScript, with what decoding needs.
type encoding struct {
	source       string
	text         string
	sentinel     string
	placeholders []placeholder
	// voids, pipes, fors, and finallys hold one entry for each void
	// expression, || operator, for statement, and finally clause of text, in
	// order: the word a void stands for (empty for a void of the source),
	// what a || stands for (empty for a || of the source; |> for a pipe,
	// followed by L and R when the encoding parenthesized its left side or
	// its body), and the text to insert after a for or finally keyword.
	voids    []string
	pipes    []string
	fors     []string
	finallys []string
	// asyncs holds one entry for each async modifier of text, in order:
	// effect for one that stands for effect (VIP-1), empty for one of the
	// source.
	asyncs []string
	// functions holds one entry for each function keyword of a function
	// declaration of text, in order: non-empty for one the encoding wrote
	// before a shorthand declaration's name, empty for one of the source.
	functions []string
	// modules are the file's module bodies, and references the number of
	// identifier module specifiers text writes as strings.
	modules    []moduleBody
	references int
}

// sentinels are the prefixes placeholders may take; a file uses the first one
// its text does not contain.
var sentinels = []string{"$v", "$w", "$x", "$y", "$z", "$vl", "$vibe", "$vibelang"}

// typeScriptOptions are the options the TypeScript forms are parsed with.
var typeScriptOptions = ast.SourceFileParseOptions{FileName: "/vibelang-format.ts", PathKey: "/vibelang-format.ts"}

// vibeOptions are the options a .vibe file is parsed with. Only the
// extension matters to the parser.
var vibeOptions = ast.SourceFileParseOptions{FileName: "/vibelang-format.vibe", PathKey: "/vibelang-format.vibe"}

// encoder builds an encoding.
type encoder struct {
	file     *ast.SourceFile
	source   string
	sentinel string
	edits    []edit
	holders  []placeholder
	// modules and references are those of the encoding.
	modules    []moduleBody
	references int
}

// encode writes source, a .vibe file, as TypeScript.
func encode(fileName, source string) (*encoding, error) {
	file, forms := parser.ParseVibeLangSyntax(vibeOptions, source)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		return nil, syntaxError(source, diagnostics[0])
	}
	if err := checkModules(file, source); err != nil {
		return nil, err
	}
	sentinel := ""
	for _, candidate := range sentinels {
		if !strings.Contains(source, candidate) {
			sentinel = candidate
			break
		}
	}
	if sentinel == "" {
		return nil, fmt.Errorf("vibelang format: the file contains every placeholder prefix (%s)", strings.Join(sentinels, ", "))
	}
	e := &encoder{file: file, source: source, sentinel: sentinel}
	forms = uniqueForms(forms)
	for _, form := range forms {
		if err := e.form(form); err != nil {
			return nil, err
		}
	}
	if err := e.clauses(forms); err != nil {
		return nil, err
	}
	return e.finish()
}

// syntaxError reports a parse diagnostic with its line and column.
func syntaxError(source string, diagnostic *ast.Diagnostic) error {
	line, column := lineColumn(source, diagnostic.Pos())
	return fmt.Errorf("vibelang format: %d:%d: %s", line, column, diagnostic.String())
}

// lineColumn returns the one-based line and column of pos.
func lineColumn(text string, pos int) (int, int) {
	pos = min(max(pos, 0), len(text))
	line := strings.Count(text[:pos], "\n") + 1
	column := pos - strings.LastIndex(text[:pos], "\n")
	return line, column
}

// uniqueForms drops forms recorded twice, which a statement the parser
// reparses records. A form is its kind, name, range, and word, since a module
// specifier records only its word.
func uniqueForms(forms []parser.VibeSyntax) []parser.VibeSyntax {
	type key struct {
		kind     parser.VibeSyntaxKind
		pos, end int
		word     int
		name     string
	}
	seen := map[key]bool{}
	var unique []parser.VibeSyntax
	for _, form := range forms {
		k := key{form.Kind, form.Range.Pos(), form.Range.End(), form.Word.Pos(), form.Name}
		if !seen[k] {
			seen[k] = true
			unique = append(unique, form)
		}
	}
	return unique
}

func (e *encoder) text(r core.TextRange) string { return e.source[r.Pos():r.End()] }

// hold adds a placeholder for text standing at pos, and returns its name,
// padded with underscores to width.
func (e *encoder) hold(kind placeholderKind, text string, pos int, width int) string {
	e.holders = append(e.holders, placeholder{kind: kind, text: text, indent: lineIndent(e.source, pos)})
	name := e.sentinel + strconv.Itoa(len(e.holders)-1)
	if width > len(name) {
		name += strings.Repeat("_", width-len(name))
	}
	return name
}

// firstLineWidth is the width of text's first line.
func firstLineWidth(text string) int {
	if i := strings.IndexByte(text, '\n'); i >= 0 {
		return len(strings.TrimRight(text[:i], " \t\r"))
	}
	return len(text)
}

// lineIndent returns the spaces and tabs that start the line holding pos.
func lineIndent(text string, pos int) string {
	start := strings.LastIndexByte(text[:pos], '\n') + 1
	end := start
	for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
		end++
	}
	return text[start:end]
}

// opaque replaces r with a placeholder of kind for its text.
func (e *encoder) opaque(kind placeholderKind, r core.TextRange, prefix, suffix string, width int) {
	text := e.text(r)
	name := e.hold(kind, text, r.Pos(), width)
	e.add(edit{pos: r.Pos(), end: r.End(), text: prefix + name + suffix, opaque: true})
}

// add adds an edit.
func (e *encoder) add(ed edit) {
	ed.seq = len(e.edits)
	e.edits = append(e.edits, ed)
}

// replace adds an edit that writes text over r, whose source text holds only
// the form's own tokens.
func (e *encoder) replace(pos, end int, text string) {
	e.add(edit{pos: pos, end: end, text: text})
}

// insert adds an insertion at pos. Insertions at one position go in order;
// among those with the same negative order, which open parentheses, the
// enclosing form's goes first, and otherwise the inner form's.
func (e *encoder) insert(pos int, text string, order int) {
	e.add(edit{pos: pos, end: pos, text: text, order: order})
}

// form adds the edits that write one recorded form as TypeScript.
func (e *encoder) form(form parser.VibeSyntax) error {
	block := "((" + e.sentinel + ") => {"
	switch form.Kind {
	case parser.VibeSyntaxEffectType, parser.VibeSyntaxTopic:
		r := form.Range
		e.opaque(placeholderText, r, "", "", firstLineWidth(e.text(r)))
	case parser.VibeSyntaxMutable:
		if form.Index {
			e.opaque(placeholderMutableIndex, form.Range, "[", "", firstLineWidth(e.text(form.Range))-1)
		} else {
			e.opaque(placeholderText, form.Range, "", "", firstLineWidth(e.text(form.Range)))
		}
	case parser.VibeSyntaxDeclaration:
		return e.declaration(form)
	case parser.VibeSyntaxBlockParam:
		e.replace(form.Head.End(), form.Open.End(), block)
		e.replace(form.Close.Pos(), form.Close.End(), "})")
	case parser.VibeSyntaxEffect:
		if form.Open.End() == 0 {
			// effect before a function: async, which TypeScript allows in each
			// of effect's positions, matched by order.
			e.add(edit{pos: form.Word.Pos(), end: form.Word.End(), text: "async", token: "async", stands: e.text(form.Word)})
			break
		}
		name := e.hold(placeholderText, e.text(form.Word), form.Word.Pos(), 0)
		e.replace(form.Word.Pos(), form.Open.End(), name+block)
		e.replace(form.Close.Pos(), form.Close.End(), "})")
	case parser.VibeSyntaxShorthand:
		e.add(edit{pos: form.Word.Pos(), end: form.Word.Pos(), text: "function ", token: "function", stands: "shorthand"})
	case parser.VibeSyntaxDo, parser.VibeSyntaxForkBlock:
		name := e.hold(placeholderText, e.text(form.Word), form.Word.Pos(), 0)
		e.replace(form.Word.Pos(), form.Open.End(), name+block)
		e.replace(form.Close.Pos(), form.Close.End(), "})")
	case parser.VibeSyntaxPrefix:
		e.add(edit{pos: form.Word.Pos(), end: form.Word.End(), text: "void", token: "void", stands: e.text(form.Word)})
	case parser.VibeSyntaxCatch:
		return e.catch(form)
	case parser.VibeSyntaxPipe:
		stands := "|>"
		if e.parenthesizeNullish(form.Left) {
			stands += "L"
		}
		if e.parenthesizeNullish(form.Right) {
			stands += "R"
		}
		e.add(edit{pos: form.Word.Pos(), end: form.Word.End(), text: "||", token: "||", stands: stands})
	case parser.VibeSyntaxIs:
		e.replace(form.Word.Pos(), form.Word.End(), "in")
		e.opaque(placeholderIsPattern, form.Right, "", "", firstLineWidth(e.text(form.Right)))
	case parser.VibeSyntaxMatch:
		return e.match(form)
	case parser.VibeSyntaxBlockStatement:
		e.opaque(placeholderBlockHead, form.Head, "", ":", firstLineWidth(e.text(form.Head))-1)
	case parser.VibeSyntaxForConcurrent:
		end := skipSpaces(e.source, form.Head.End())
		// The saved head already contains nested prefixes; do not encode them twice.
		e.add(edit{pos: form.Head.Pos(), end: end, opaque: true, token: "for", keyword: form.Word.Pos(), stands: e.source[form.Head.Pos():end]})
	case parser.VibeSyntaxStatement:
		e.opaque(placeholderText, form.Range, "", "", firstLineWidth(e.text(form.Range)))
	case parser.VibeSyntaxClause:
		// Written with the try statement's other clauses (clauses).
	case parser.VibeSyntaxModule:
		// TypeScript syntax too; the body is TypeScript (modules.go).
		e.modules = append(e.modules, moduleBody{name: form.Name, body: core.NewTextRange(form.Open.End(), form.Close.Pos())})
	case parser.VibeSyntaxModuleReference:
		e.replace(form.Word.Pos(), form.Word.End(), moduleSpecifierString(e.sentinel, e.text(form.Word)))
		e.references++
	default:
		return fmt.Errorf("vibelang format: no TypeScript form for VibeLang syntax kind %d", form.Kind)
	}
	return nil
}

// declaration writes error and schema as a type alias, a schema alias as the
// type alias it is written as, service and control as a class, and layer as
// a placeholder statement. An error written with a class's features (D278)
// is a class too, given an empty body when it has none: error Timeout
// extends AppError.
func (e *encoder) declaration(form parser.VibeSyntax) error {
	head := declarationKeywordSpacing(e.text(form.Head))
	if form.Class {
		// A constructor payload is a field, but TypeScript's class parser
		// reserves its unquoted name for constructor methods. Preserve the
		// source name through an ordinary identifier while formatting.
		for _, name := range form.FieldNames {
			e.opaque(placeholderText, name, "", "", firstLineWidth(e.text(name)))
		}
		name := e.hold(placeholderClassHead, head, form.Head.Pos(), firstLineWidth(head)-len("class "))
		e.add(edit{pos: form.Head.Pos(), end: form.Head.End(), text: "class " + name, opaque: true})
		if form.Open.Pos() == form.Open.End() {
			e.holders[len(e.holders)-1].noBody = true
			e.insert(form.Range.End(), " {}", 0)
		}
		return nil
	}
	switch form.Name {
	case "error", "schema", "schema error":
		name := e.hold(placeholderTypeHead, head, form.Head.Pos(), firstLineWidth(head)-len("type  ="))
		e.add(edit{pos: form.Head.Pos(), end: form.Head.End(), text: "type " + name, opaque: true})
		if form.Open.Pos() == form.Open.End() {
			e.holders[len(e.holders)-1].noBody = true
			e.insert(form.Range.End(), " = {}", 0)
		} else {
			e.insert(form.Open.Pos(), "= ", 0)
		}
	case parser.VibeSyntaxData:
		// data D { A; B { f: T } } is type $v = { A; B: { f: T } }: a variant
		// is a property, and its fields, if any, its type.
		name := e.hold(placeholderTypeHead, head, form.Head.Pos(), firstLineWidth(head)-len("type  ="))
		e.holders[len(e.holders)-1].data = true
		e.add(edit{pos: form.Head.Pos(), end: form.Head.End(), text: "type " + name, opaque: true})
		e.insert(form.Open.Pos(), "= ", 0)
		for _, variant := range form.Variants {
			if variant.Open.Pos() != variant.Open.End() {
				e.insert(variant.Name.End(), ":", 0)
			}
		}
	case parser.VibeSyntaxSchemaAlias:
		// schema Code = "a" | "b" is type $v = "a" | "b": only the head changes.
		name := e.hold(placeholderTypeHead, head, form.Head.Pos(), firstLineWidth(head)-len("type "))
		e.holders[len(e.holders)-1].alias = true
		e.add(edit{pos: form.Head.Pos(), end: form.Head.End(), text: "type " + name, opaque: true})
	case "service", "control":
		// The head of service Prefix: string runs through the shape (D281),
		// which the placeholder keeps as written, with one space after the colon.
		head = declarationKeywordSpacing(e.shapeHead(form, head))
		name := e.hold(placeholderClassHead, head, form.Head.Pos(), firstLineWidth(head)-len("class "))
		e.add(edit{pos: form.Head.Pos(), end: form.Head.End(), text: "class " + name, opaque: true})
		if form.Open.Pos() == form.Open.End() {
			// service Prefix: string, written without a body.
			e.holders[len(e.holders)-1].noBody = true
			e.insert(form.Range.End(), " {}", 0)
		}
	default:
		text := declarationKeywordSpacing(e.text(form.Range))
		name := e.hold(placeholderText, text, form.Range.Pos(), firstLineWidth(text))
		e.add(edit{pos: form.Range.Pos(), end: form.Range.End(), text: name, opaque: true})
	}
	return nil
}

// declarationKeywordSpacing normalizes the gaps after declaration keywords.
// Headers are opaque to the TypeScript formatter; comments and line breaks
// must stay in place, as must whitespace inside a service's shape.
func declarationKeywordSpacing(head string) string {
	var out strings.Builder
	for {
		end := strings.IndexAny(head, " \t\r\n")
		if end < 0 {
			return out.String() + head
		}
		word := head[:end]
		switch word {
		case "error", "schema", "service", "class", "control", "data", "layer":
		default:
			return out.String() + head
		}
		next := end
		for next < len(head) && (head[next] == ' ' || head[next] == '\t') {
			next++
		}
		if next == end || next == len(head) || head[next] == '/' || head[next] == '\n' || head[next] == '\r' {
			return out.String() + head
		}
		out.WriteString(word)
		out.WriteByte(' ')
		head = head[next:]
	}
}

// shapeHead returns head, the head of a service declaration, with the
// colon of service Prefix:   string written as ": " (D281). A head with a
// comment or a line break around the colon stays as written.
func (e *encoder) shapeHead(form parser.VibeSyntax, head string) string {
	if form.Right.Pos() == form.Right.End() {
		return head
	}
	before := strings.TrimRight(e.source[form.Head.Pos():form.Right.Pos()], " \t")
	if !strings.HasSuffix(before, ":") {
		return head
	}
	name := strings.TrimRight(before[:len(before)-1], " \t")
	if strings.ContainsAny(before[len(name):], "\n/") {
		return head
	}
	return name + ": " + e.text(form.Right)
}

// catch writes x catch y as x.$v(y), keeping the space before catch, so a
// line break there stays as a break in a member chain does. A left side whose
// last token cannot take a property access gets parentheses.
func (e *encoder) catch(form parser.VibeSyntax) error {
	left := e.nodeAt(form.Left)
	if left != nil && needsParenthesesForAccess(left) {
		e.insert(form.Left.Pos(), "(", -1)
		e.insert(form.Left.End(), ")", -1)
	}
	name := e.hold(placeholderCatch, "catch", form.Word.Pos(), 0)
	e.replace(form.Word.Pos(), form.Word.End(), "."+name+"(")
	e.insert(form.Right.End(), ")", 1)
	return nil
}

// parenthesizeNullish puts parentheses around a pipe's operand when it is a
// ?? expression, which TypeScript does not let || take without them, and
// reports whether it did; decoding removes them.
func (e *encoder) parenthesizeNullish(r core.TextRange) bool {
	node := e.nodeAt(r)
	if node != nil && node.Kind == ast.KindBinaryExpression && node.AsBinaryExpression().OperatorToken.Kind == ast.KindQuestionQuestionToken {
		e.insert(r.Pos(), "(", -1)
		e.insert(r.End(), ")", 2)
		return true
	}
	return false
}

// match writes a match as an object literal whose first property holds the
// subject and whose other properties are the arms.
func (e *encoder) match(form parser.VibeSyntax) error {
	separator := " "
	next := form.Close.Pos()
	if len(form.Arms) != 0 {
		next = form.Arms[0].Head.Pos()
	}
	if strings.Contains(e.source[form.Open.End():next], "\n") {
		separator = "\n"
	}
	// A statement match lowers to a labeled block. Give its projection a
	// unary head so an ASI boundary before match cannot become a call of
	// the preceding expression. Unlike a leading semicolon, void also works
	// when the match is the unbraced body of an if or loop.
	statement := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if (node.Kind == ast.KindLabeledStatement || node.Kind == ast.KindBlock) && scanner.SkipTrivia(e.source, node.Pos()) == form.Word.Pos() {
			statement = true
			return true
		}
		return node.ForEachChild(visit)
	}
	e.file.AsNode().ForEachChild(visit)
	prefix, marker := "", ""
	if statement {
		prefix, marker = "void ", "statement match"
	}
	head := e.hold(placeholderMatchHead, marker, form.Word.Pos(), 0)
	e.replace(form.Word.Pos(), form.Left.Pos(), prefix+"({"+separator+head+": ")
	if len(form.Arms) == 0 {
		e.replace(form.Left.End(), form.Open.End(), "")
	} else {
		e.replace(form.Left.End(), form.Open.End(), ",")
	}
	for i, arm := range form.Arms {
		if headText := e.text(arm.Head); strings.HasPrefix(headText, "when") {
			e.opaque(placeholderMatchArm, arm.Head, "", "", firstLineWidth(headText))
		}
		last := i == len(form.Arms)-1
		switch {
		case arm.Semicolon.Pos() != arm.Semicolon.End() && last:
			e.replace(arm.Semicolon.Pos(), arm.Semicolon.End(), "")
		case arm.Semicolon.Pos() != arm.Semicolon.End():
			e.replace(arm.Semicolon.Pos(), arm.Semicolon.End(), ",")
		case !last:
			e.insert(arm.Value.End(), ",", 1)
		}
	}
	e.replace(form.Close.Pos(), form.Close.End(), "})")
	return nil
}

// tryClause is one clause of a try statement, as clauses chains them.
type tryClause struct {
	name  string
	head  core.TextRange // the keyword through the header, without trailing space
	close int            // the end of the clause's block
	// binding is a finally clause's (exit), with the space before it.
	binding core.TextRange
}

// clauses writes the catch, handle, and finally clauses of each try statement.
// TypeScript takes one catch and one finally; a try statement with more, or
// with a handle clause, keeps its first clause as a catch and writes each
// clause after it as a labeled block after the statement.
func (e *encoder) clauses(forms []parser.VibeSyntax) error {
	var all []tryClause
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxClause {
			continue
		}
		clause := tryClause{name: form.Name, head: trimRange(e.source, form.Head), close: form.Close.End()}
		if form.Name == "finally" {
			clause.binding = core.NewTextRange(form.Word.End(), form.Right.End())
		}
		all = append(all, clause)
	}
	slices.SortFunc(all, func(a, b tryClause) int { return a.head.Pos() - b.head.Pos() })
	for i := 0; i < len(all); {
		chain := []tryClause{all[i]}
		i++
		for i < len(all) && scanner.SkipTrivia(e.source, chain[len(chain)-1].close) == all[i].head.Pos() {
			chain = append(chain, all[i])
			i++
		}
		if last := chain[len(chain)-1]; last.name != "finally" {
			if pos := scanner.SkipTrivia(e.source, last.close); startsWithWord(e.source[pos:], "finally") {
				chain = append(chain, tryClause{name: "finally", head: core.NewTextRange(pos, pos+len("finally"))})
			}
		}
		if err := e.chain(chain); err != nil {
			return err
		}
	}
	return nil
}

// chain writes one try statement's clauses.
func (e *encoder) chain(chain []tryClause) error {
	native := len(chain) == 1 && chain[0].name != "handle" ||
		len(chain) == 2 && chain[0].name == "catch" && chain[1].name == "finally"
	if native {
		for _, clause := range chain {
			if clause.binding.Pos() != clause.binding.End() {
				e.add(edit{pos: clause.binding.Pos(), end: clause.binding.End(), token: "finally", keyword: clause.head.Pos(), stands: e.text(clause.binding)})
			}
		}
		return nil
	}
	if first := chain[0]; first.name == "handle" {
		text := e.text(first.head)
		e.opaque(placeholderHandleHead, first.head, "catch (", ")", firstLineWidth(text)-len("catch ()"))
	}
	for i := 1; i < len(chain); i++ {
		previous, clause := chain[i-1], chain[i]
		if gap := e.source[previous.close:clause.head.Pos()]; strings.TrimSpace(gap) != "" {
			line, column := lineColumn(e.source, previous.close)
			return fmt.Errorf("vibelang format: %d:%d: a comment between the clauses of a try statement cannot be formatted; move it into a clause's block", line, column)
		}
		text := e.text(clause.head)
		name := e.hold(placeholderClauseHead, text, clause.head.Pos(), firstLineWidth(text)-1)
		e.add(edit{pos: previous.close, end: clause.head.End(), text: "\n" + name + ":", opaque: true})
	}
	return nil
}

// finish orders and checks the edits, writes the TypeScript, and records the
// tokens decoding matches by order.
func (e *encoder) finish() (*encoding, error) {
	edits := dropNested(e.edits)
	e.markNested(edits)
	slices.SortStableFunc(edits, compareEdits)
	var out strings.Builder
	// marks holds, for each kind of token matched by order, the TypeScript
	// offset of each token an edit wrote or kept and what it stands for.
	marks := map[string]map[int]string{"void": {}, "||": {}, "for": {}, "finally": {}, "async": {}, "function": {}}
	written := map[string]int{}
	var keywords []edit // for and finally keywords, by source position
	for _, ed := range edits {
		if ed.token == "for" || ed.token == "finally" {
			keywords = append(keywords, ed)
		}
	}
	slices.SortFunc(keywords, func(a, b edit) int { return a.keyword - b.keyword })
	cursor := 0
	copySource := func(to int) {
		for _, ed := range keywords {
			if ed.keyword >= cursor && ed.keyword < to {
				marks[ed.token][out.Len()+ed.keyword-cursor] = ed.stands
			}
		}
		out.WriteString(e.source[cursor:to])
		cursor = to
	}
	for _, ed := range edits {
		if ed.pos < cursor {
			line, column := lineColumn(e.source, ed.pos)
			return nil, fmt.Errorf("vibelang format: internal error: overlapping edits at %d:%d", line, column)
		}
		copySource(ed.pos)
		if !ed.opaque {
			if replaced := e.source[ed.pos:ed.end]; hasComment(replaced) {
				line, column := lineColumn(e.source, ed.pos)
				return nil, fmt.Errorf("vibelang format: %d:%d: a comment inside VibeLang syntax cannot be formatted; move it before or after the form: %q", line, column, replaced)
			}
		}
		if ed.token != "" {
			written[ed.token]++
		}
		if ed.token == "void" || ed.token == "||" || ed.token == "async" || ed.token == "function" {
			marks[ed.token][out.Len()] = ed.stands
		}
		out.WriteString(ed.text)
		cursor = ed.end
	}
	copySource(len(e.source))
	result := &encoding{source: e.source, text: out.String(), sentinel: e.sentinel, placeholders: e.holders, modules: e.modules, references: e.references}

	file := parser.ParseSourceFile(typeScriptOptions, result.text, core.ScriptKindTS)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		line, column := lineColumn(result.text, diagnostics[0].Pos())
		return nil, fmt.Errorf("vibelang format: internal error: the TypeScript form does not parse at %d:%d: %s\n%s", line, column, diagnostics[0].String(), result.text)
	}
	tokens := collectTokens(file, result.text)
	found := map[string]int{}
	match := func(token string, positions []int) []string {
		values := make([]string, len(positions))
		for i, pos := range positions {
			if stands, ok := marks[token][pos]; ok {
				values[i] = stands
				found[token]++
			}
		}
		return values
	}
	result.voids = match("void", tokens.voids)
	result.pipes = match("||", tokens.ors)
	result.fors = match("for", tokens.fors)
	result.finallys = match("finally", tokens.finallys)
	result.asyncs = match("async", tokens.asyncs)
	result.functions = match("function", tokens.functions)
	for _, token := range []string{"void", "||", "for", "finally", "async", "function"} {
		if written[token] != found[token] {
			return nil, fmt.Errorf("vibelang format: internal error: wrote %d %s tokens, found %d", written[token], token, found[token])
		}
	}
	return result, nil
}

// compareEdits orders edits by position; at one position insertions come
// first, by order.
func compareEdits(a, b edit) int {
	if a.pos != b.pos {
		return a.pos - b.pos
	}
	aInsert, bInsert := a.pos == a.end, b.pos == b.end
	switch {
	case aInsert && !bInsert:
		return -1
	case !aInsert && bInsert:
		return 1
	}
	if a.order != b.order {
		return a.order - b.order
	}
	if a.order < 0 {
		return b.seq - a.seq
	}
	return a.seq - b.seq
}

// dropNested removes the edits inside an opaque edit, whose text the
// placeholder keeps as written. An insertion at an opaque edit's edge is
// outside it.
func dropNested(edits []edit) []edit {
	var kept []edit
	for _, ed := range edits {
		nested := false
		for _, outer := range edits {
			if !outer.opaque || outer.seq == ed.seq {
				continue
			}
			if ed.pos == ed.end && outer.pos < ed.pos && ed.pos < outer.end ||
				ed.pos < ed.end && outer.pos <= ed.pos && ed.end <= outer.end && (outer.pos != ed.pos || outer.end != ed.end) {
				nested = true
				break
			}
		}
		if !nested {
			kept = append(kept, ed)
		}
	}
	return kept
}

// markNested marks the placeholders that only the edits dropNested dropped
// wrote: kept holds the edits it kept.
func (e *encoder) markNested(kept []edit) {
	written := map[int]bool{}
	for _, ed := range kept {
		written[ed.seq] = true
	}
	for _, ed := range e.edits {
		if written[ed.seq] {
			continue
		}
		for rest := ed.text; ; {
			at := strings.Index(rest, e.sentinel)
			if at < 0 {
				break
			}
			rest = rest[at+len(e.sentinel):]
			digits := 0
			for digits < len(rest) && rest[digits] >= '0' && rest[digits] <= '9' {
				digits++
			}
			if index, err := strconv.Atoi(rest[:digits]); err == nil && index < len(e.holders) {
				e.holders[index].nested = true
			}
		}
	}
}

// hasComment reports whether text, which holds no string literal, has a comment.
func hasComment(text string) bool {
	return strings.Contains(text, "//") || strings.Contains(text, "/*")
}

// trimRange returns r without the spaces that end it.
func trimRange(text string, r core.TextRange) core.TextRange {
	end := r.End()
	for end > r.Pos() && isSpace(text[end-1]) {
		end--
	}
	return core.NewTextRange(r.Pos(), end)
}

func isSpace(c byte) bool { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }

// skipSpaces returns the first position at or after pos that is not a space.
func skipSpaces(text string, pos int) int {
	for pos < len(text) && isSpace(text[pos]) {
		pos++
	}
	return pos
}

// startsWithWord reports whether text starts with word as a whole word.
func startsWithWord(text, word string) bool {
	return strings.HasPrefix(text, word) && (len(text) == len(word) || !isIdentifierByte(text[len(word)]))
}

func isIdentifierByte(c byte) bool {
	return c == '_' || c == '$' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= 0x80
}

// nodeAt returns the outermost node of the file whose range, without leading
// trivia, is r.
func (e *encoder) nodeAt(r core.TextRange) *ast.Node {
	var found *ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found != nil || node.End() < r.Pos() || node.Pos() > r.End() {
			return false
		}
		if scanner.SkipTrivia(e.source, node.Pos()) == r.Pos() && node.End() == r.End() && node.Flags&ast.NodeFlagsReparsed == 0 {
			found = node
			return true
		}
		node.ForEachChild(visit)
		return found != nil
	}
	e.file.AsNode().ForEachChild(visit)
	return found
}

// needsParenthesesForAccess reports whether node, a catch expression's left
// side, ends in a type or a postfix operator, after which .name does not
// continue the expression.
func needsParenthesesForAccess(node *ast.Node) bool {
	for {
		switch node.Kind {
		case ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindPostfixUnaryExpression:
			return true
		case ast.KindBinaryExpression:
			node = node.AsBinaryExpression().Right
		case ast.KindPrefixUnaryExpression:
			node = node.AsPrefixUnaryExpression().Operand
		case ast.KindTypeOfExpression, ast.KindVoidExpression, ast.KindDeleteExpression, ast.KindAwaitExpression:
			node = node.Expression()
		default:
			return false
		}
	}
}
