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

// tokens are the positions of the tokens decoding matches by order: void
// keywords, || operators, for keywords, finally keywords, and async
// modifiers; orNodes are the binary expressions of ors.
type tokens struct {
	voids, ors, fors, finallys, asyncs, functions []int
	orNodes                                       map[int]*ast.Node
}

// collectTokens finds the tokens of file, a parse of text, that decoding
// matches by order, sorted by position.
func collectTokens(file *ast.SourceFile, text string) tokens {
	t := tokens{orNodes: map[int]*ast.Node{}}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if modifiers := node.Modifiers(); modifiers != nil {
			for _, m := range modifiers.Nodes {
				if m.Kind == ast.KindAsyncKeyword {
					t.asyncs = append(t.asyncs, scanner.SkipTrivia(text, m.Pos()))
				}
			}
		}
		if node.Kind == ast.KindFunctionDeclaration {
			start := scanner.SkipTrivia(text, node.Pos())
			if modifiers := node.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
				start = scanner.SkipTrivia(text, modifiers.Nodes[len(modifiers.Nodes)-1].End())
			}
			t.functions = append(t.functions, start)
		}
		switch node.Kind {
		case ast.KindVoidExpression:
			t.voids = append(t.voids, scanner.SkipTrivia(text, node.Pos()))
		case ast.KindBinaryExpression:
			if operator := node.AsBinaryExpression().OperatorToken; operator.Kind == ast.KindBarBarToken {
				pos := scanner.SkipTrivia(text, operator.Pos())
				t.ors = append(t.ors, pos)
				t.orNodes[pos] = node
			}
		case ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
			t.fors = append(t.fors, scanner.SkipTrivia(text, node.Pos()))
		case ast.KindTryStatement:
			if block := node.AsTryStatement().FinallyBlock; block != nil {
				t.finallys = append(t.finallys, block.Pos()-len("finally"))
			}
		}
		node.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	slices.Sort(t.voids)
	slices.Sort(t.ors)
	slices.Sort(t.fors)
	slices.Sort(t.finallys)
	slices.Sort(t.asyncs)
	slices.Sort(t.functions)
	return t
}

// decoder writes the formatted TypeScript form of a file back as VibeLang.
type decoder struct {
	enc   *encoding
	text  string
	file  *ast.SourceFile
	edits []edit
	seen  []bool
	// references counts the identifier module specifiers decoded.
	references int
}

// decode returns formatted, the TypeScript formatter's output for enc.text,
// written as VibeLang.
func (enc *encoding) decode(formatted string) (string, error) {
	file := parser.ParseSourceFile(typeScriptOptions, formatted, core.ScriptKindTS)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		line, column := lineColumn(formatted, diagnostics[0].Pos())
		return "", fmt.Errorf("vibelang format: internal error: the formatted TypeScript form does not parse at %d:%d: %s", line, column, diagnostics[0].String())
	}
	d := &decoder{enc: enc, text: formatted, file: file, seen: make([]bool, len(enc.placeholders))}
	if err := d.ordered(); err != nil {
		return "", err
	}
	var failure error
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if failure != nil {
			return true
		}
		if err := d.node(node); err != nil {
			failure = err
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if failure != nil {
		return "", failure
	}
	for i, seen := range d.seen {
		if !seen && !enc.placeholders[i].nested {
			return "", fmt.Errorf("vibelang format: internal error: the formatter dropped the placeholder for %q", enc.placeholders[i].text)
		}
	}
	if d.references != enc.references {
		return "", fmt.Errorf("vibelang format: internal error: wrote %d identifier module specifiers, found %d", enc.references, d.references)
	}
	return d.apply()
}

// ordered decodes the tokens matched by order.
func (d *decoder) ordered() error {
	t := collectTokens(d.file, d.text)
	if len(t.voids) != len(d.enc.voids) || len(t.ors) != len(d.enc.pipes) || len(t.fors) != len(d.enc.fors) || len(t.finallys) != len(d.enc.finallys) || len(t.asyncs) != len(d.enc.asyncs) || len(t.functions) != len(d.enc.functions) {
		return fmt.Errorf("vibelang format: internal error: the formatter changed the number of void, ||, for, finally, async, or function tokens")
	}
	// The TypeScript formatter needs function, but the source shorthand must
	// retain its EK4618 diagnostic. Only --fix inserts function permanently.
	for i, pos := range t.functions {
		if d.enc.functions[i] == "shorthand" {
			end := pos + len("function")
			if end < len(d.text) && d.text[end] == ' ' {
				end++
			}
			d.replace(pos, end, "")
		}
	}
	for i, pos := range t.asyncs {
		if word := d.enc.asyncs[i]; word != "" {
			d.replace(pos, pos+len("async"), word)
		}
	}
	for i, pos := range t.voids {
		if word := d.enc.voids[i]; word != "" {
			d.replace(pos, pos+len("void"), word)
		}
	}
	for i, pos := range t.ors {
		stands := d.enc.pipes[i]
		if stands == "" {
			continue
		}
		d.replace(pos, pos+len("||"), "|>")
		binary := t.orNodes[pos].AsBinaryExpression()
		for _, side := range []struct {
			flag    string
			operand *ast.Node
		}{{"L", binary.Left}, {"R", binary.Right}} {
			if !strings.Contains(stands, side.flag) {
				continue
			}
			if side.operand.Kind != ast.KindParenthesizedExpression {
				return fmt.Errorf("vibelang format: internal error: the formatter removed the parentheses around a pipe's operand")
			}
			open := d.start(side.operand)
			d.replace(open, open+1, "")
			d.replace(side.operand.End()-1, side.operand.End(), "")
		}
	}
	for i, pos := range t.fors {
		if text := d.enc.fors[i]; text != "" {
			open := scanner.SkipTrivia(d.text, pos+len("for"))
			d.insert(open, text)
		}
	}
	for i, pos := range t.finallys {
		if text := d.enc.finallys[i]; text != "" {
			d.insert(pos+len("finally"), text)
		}
	}
	return nil
}

func (d *decoder) replace(pos, end int, text string) {
	d.edits = append(d.edits, edit{pos: pos, end: end, text: text, seq: len(d.edits)})
}

func (d *decoder) insert(pos int, text string) {
	d.edits = append(d.edits, edit{pos: pos, end: pos, text: text, seq: len(d.edits)})
}

// start is node's position without leading trivia.
func (d *decoder) start(node *ast.Node) int { return scanner.SkipTrivia(d.text, node.Pos()) }

// placeholderOf returns the index of the placeholder node names, or -1.
func (d *decoder) placeholderOf(node *ast.Node) int {
	if node == nil || node.Kind != ast.KindIdentifier {
		return -1
	}
	name := node.Text()
	if !strings.HasPrefix(name, d.enc.sentinel) {
		return -1
	}
	digits := strings.TrimRight(name[len(d.enc.sentinel):], "_")
	index, err := strconv.Atoi(digits)
	if err != nil || index < 0 || index >= len(d.enc.placeholders) || digits == "" || digits[0] == '+' || digits[0] == '-' {
		return -1
	}
	return index
}

// isBlockMarker reports whether node is the arrow function that stands for a
// VibeLang block: (($v) => { ... }).
func (d *decoder) isBlockMarker(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindArrowFunction {
		return false
	}
	parameters := node.Parameters()
	if len(parameters) != 1 || node.Body() == nil || node.Body().Kind != ast.KindBlock {
		return false
	}
	name := parameters[0].Name()
	return name.Kind == ast.KindIdentifier && name.Text() == d.enc.sentinel
}

// nextToken returns the start and end of the single-character token after pos.
func (d *decoder) nextToken(pos int, want byte) (int, int, bool) {
	at := scanner.SkipTrivia(d.text, pos)
	if at < len(d.text) && d.text[at] == want {
		return at, at + 1, true
	}
	return at, at, false
}

// node decodes the VibeLang form node stands for, if any.
func (d *decoder) node(node *ast.Node) error {
	if node.Kind == ast.KindStringLiteral {
		return d.moduleReference(node)
	}
	if node.Kind == ast.KindCallExpression {
		call := node.AsCallExpression()
		if arguments := call.Arguments.Nodes; len(arguments) == 1 && d.isBlockMarker(arguments[0]) {
			block := arguments[0].Body()
			open := d.start(block)
			d.replace(call.Expression.End(), open+1, " {")
			d.replace(block.End()-1, node.End(), "}")
		}
	}
	index := d.placeholderOf(node)
	if index < 0 {
		return nil
	}
	if d.seen[index] {
		return fmt.Errorf("vibelang format: internal error: the formatter repeated the placeholder for %q", d.enc.placeholders[index].text)
	}
	d.seen[index] = true
	holder := d.enc.placeholders[index]
	start, end := d.start(node), node.End()
	parent := node.Parent
	lost := func() error {
		return fmt.Errorf("vibelang format: internal error: the placeholder for %q lost its place", holder.text)
	}
	switch holder.kind {
	case placeholderText:
		d.replace(start, end, d.reindent(holder, start))
	case placeholderIsPattern:
		if parent.Kind != ast.KindBinaryExpression || parent.AsBinaryExpression().Right != node || parent.AsBinaryExpression().OperatorToken.Kind != ast.KindGreaterThanEqualsToken {
			return lost()
		}
		binary := parent.AsBinaryExpression()
		operator := d.start(binary.OperatorToken)
		// The is production forbids a line terminator before is and before
		// its pattern (parser.nextTokenStartsPattern). A host formatter may
		// wrap a relational operator on either side at narrow widths. Join only
		// that whitespace, leaving intervening block comments intact.
		joinedBefore, err := d.joinIsLine(binary.Left.End(), operator, lost)
		if err != nil {
			return err
		}
		joinedAfter, err := d.joinIsLine(operator+len(">="), start, lost)
		if err != nil {
			return err
		}
		// Multiline patterns follow the line the pattern now starts on: the
		// subject's final line after a join before is, the operator's line
		// after a join before the pattern, otherwise their own.
		patternPos := start
		if joinedBefore {
			patternPos = binary.Left.End() - 1
		} else if joinedAfter {
			patternPos = operator
		}
		d.replace(operator, operator+len(">="), "is")
		d.replace(start, end, d.reindent(holder, patternPos))
		if err := d.restorePatternBodies(node, holder.bodyKinds); err != nil {
			return err
		}
	case placeholderMutableIndex:
		bracket := start - 1
		for bracket >= 0 && isSpace(d.text[bracket]) {
			bracket--
		}
		if bracket < 0 || d.text[bracket] != '[' {
			return lost()
		}
		d.replace(bracket, end, d.reindent(holder, start))
	case placeholderMatchHead:
		return d.match(node, holder.text == "statement match", holder.text == "grouped match", lost)
	case placeholderMatchArm:
		d.replace(start, end, d.reindent(holder, start))
	case placeholderBlockHead, placeholderClauseHead:
		if parent.Kind != ast.KindLabeledStatement || parent.AsLabeledStatement().Label != node {
			return lost()
		}
		_, colon, ok := d.nextToken(end, ':')
		if !ok {
			return lost()
		}
		if holder.kind == placeholderBlockHead {
			d.replace(start, colon, d.reindent(holder, start))
			return nil
		}
		previous := d.previousStatement(parent)
		if previous == nil {
			return lost()
		}
		d.replace(previous.End(), colon, " "+d.reindent(holder, start))
	case placeholderHandleHead:
		declaration := parent
		if declaration.Kind != ast.KindVariableDeclaration || declaration.Parent.Kind != ast.KindCatchClause {
			return lost()
		}
		_, closing, ok := d.nextToken(declaration.End(), ')')
		if !ok {
			return lost()
		}
		d.replace(d.start(declaration.Parent), closing, d.reindent(holder, start))
	case placeholderTypeHead:
		alias := parent
		if alias.Kind != ast.KindTypeAliasDeclaration || alias.Name() != node {
			return lost()
		}
		keyword := d.afterModifiers(alias)
		d.replace(keyword, end, d.reindent(holder, start))
		if holder.alias {
			return nil // schema Name = Type keeps its = and type
		}
		after := end
		if list := alias.TypeParameterList(); list != nil {
			_, greater, ok := d.nextToken(list.End(), '>')
			if !ok {
				return lost()
			}
			after = greater
		}
		value := alias.Type()
		if holder.noBody {
			d.replace(after, value.End(), "")
		} else {
			// Keep the formatter's layout before the synthetic equals. Moving
			// a next-line body onto the header after its indentation has been
			// computed makes the next format pass change that indentation.
			equals, _, ok := d.nextToken(after, '=')
			if !ok {
				return lost()
			}
			d.replace(equals, d.start(value), "")
		}
		if holder.data {
			// A data declaration's variants (D307): drop the colon before a
			// variant's fields.
			if value.Kind != ast.KindTypeLiteral {
				return lost()
			}
			for _, variant := range value.Members() {
				if variant.Kind != ast.KindPropertySignature || variant.Type() == nil {
					continue
				}
				colon, after, ok := d.nextToken(variant.Name().End(), ':')
				if !ok {
					return lost()
				}
				d.replace(colon, after, "")
			}
		}
	case placeholderClassHead:
		class := parent
		if class.Kind != ast.KindClassDeclaration || class.Name() != node {
			return lost()
		}
		d.replace(d.afterModifiers(class), end, d.reindent(holder, start))
		if holder.noBody {
			// An error written as a class or a service of any shape without a
			// body (D278, D281): drop the {} the encoder added.
			if len(class.Members()) != 0 {
				return lost()
			}
			last := end
			if list := class.TypeParameterList(); list != nil {
				_, greater, ok := d.nextToken(list.End(), '>')
				if !ok {
					return lost()
				}
				last = greater
			}
			if clauses := class.ClassLikeData().HeritageClauses; clauses != nil && len(clauses.Nodes) != 0 {
				last = clauses.Nodes[len(clauses.Nodes)-1].End()
			}
			d.replace(last, class.End(), "")
		}
	case placeholderCatch:
		access := parent
		if access.Kind != ast.KindPropertyAccessExpression || access.Name() != node || access.Parent.Kind != ast.KindCallExpression || access.Parent.Expression() != access {
			return lost()
		}
		call := access.Parent
		arguments := call.Arguments()
		if len(arguments) != 1 {
			return lost()
		}
		// The dot ends the space after the left side; a line break there stays.
		dot := strings.LastIndexByte(d.text[:start], '.')
		if dot < access.Expression().End() {
			return lost()
		}
		_, open, ok := d.nextToken(access.End(), '(')
		if !ok {
			return lost()
		}
		end := d.start(arguments[0])
		trivia := d.text[open:end]
		head := "catch"
		if hasComment(trivia) {
			// Leave the handler's comments and line breaks in place.
			end = open
			if !isSpace(trivia[0]) {
				head += " "
			}
		} else {
			head += " "
		}
		if dot == access.Expression().End() {
			head = " " + head
		}
		d.replace(dot, end, head)
		d.replace(arguments[0].End(), call.End(), "")
	default:
		return lost()
	}
	return nil
}

// afterModifiers returns the position of the keyword that follows the
// modifiers of declaration.
func (d *decoder) afterModifiers(declaration *ast.Node) int {
	if modifiers := declaration.Modifiers(); modifiers != nil && len(modifiers.Nodes) != 0 {
		return scanner.SkipTrivia(d.text, modifiers.End())
	}
	return d.start(declaration)
}

// previousStatement returns the statement before statement in its parent.
func (d *decoder) previousStatement(statement *ast.Node) *ast.Node {
	var previous, found *ast.Node
	statement.Parent.ForEachChild(func(child *ast.Node) bool {
		if child == statement {
			found = previous
			return true
		}
		previous = child
		return false
	})
	return found
}

// match decodes the object literal ({ $v: subject, arms }) that stands for a
// match, whose subject property's name is head.
func (d *decoder) match(head *ast.Node, statement, groupedMatch bool, lost func() error) error {
	property := head.Parent
	if property.Kind != ast.KindPropertyAssignment || property.Name() != head || property.Parent.Kind != ast.KindObjectLiteralExpression {
		return lost()
	}
	object := property.Parent
	properties := object.Properties()
	if properties[0] != property {
		return lost()
	}
	outer := object
	if outer.Parent.Kind == ast.KindParenthesizedExpression {
		outer = outer.Parent
	}
	if statement {
		if outer.Parent.Kind != ast.KindVoidExpression {
			return lost()
		}
		outer = outer.Parent
	}
	outerStart := d.start(outer)
	if !groupedMatch && outerStart > 0 && d.text[outerStart-1] == ';' && (outerStart == 1 || isSpace(d.text[outerStart-2])) {
		outerStart-- // the semicolon a formatter writes before ( at the start of a statement
	}
	subject := property.Initializer()
	prefix, suffix := "match (", "}"
	if groupedMatch && outer.Parent.Kind != ast.KindParenthesizedExpression {
		prefix, suffix = "(match (", "})"
	}
	d.replace(outerStart, d.start(subject), prefix)
	if len(properties) == 1 {
		d.replace(subject.End(), outer.End(), ") {"+suffix)
		return nil
	}
	_, comma, ok := d.nextToken(subject.End(), ',')
	if !ok {
		return lost()
	}
	d.replace(subject.End(), comma, ") {")
	for i, arm := range properties[1:] {
		if arm.Kind != ast.KindPropertyAssignment {
			return lost()
		}
		last := i == len(properties)-2
		at, after, ok := d.nextToken(arm.End(), ',')
		switch {
		case ok:
			d.replace(at, after, ";")
		case last:
			d.insert(arm.End(), ";")
		default:
			return lost()
		}
	}
	d.replace(object.End()-1, outer.End(), suffix)
	return nil
}

// joinIsLine replaces the whitespace between from and to, the trivia on one
// side of an is surrogate, with a single space when it contains a line
// terminator. Block comments stay in place; any other token is lost.
func (d *decoder) joinIsLine(from, to int, lost func() error) (joined bool, err error) {
	for at := from; at < to; {
		spaceEnd := scanner.SkipTriviaEx(d.text, at, &scanner.SkipTriviaOptions{StopAtComments: true})
		if strings.ContainsAny(d.text[at:spaceEnd], "\r\n\u2028\u2029") {
			d.replace(at, spaceEnd, " ")
			joined = true
		}
		if spaceEnd >= to {
			break
		}
		if !strings.HasPrefix(d.text[spaceEnd:to], "/*") {
			return joined, lost()
		}
		close := strings.Index(d.text[spaceEnd:to], "*/")
		if close < 0 {
			return joined, lost()
		}
		at = spaceEnd + close + len("*/")
	}
	return joined, nil
}

// reindent returns holder's text, whose lines after the first move with the
// line its placeholder now starts at pos.
func (d *decoder) reindent(holder placeholder, pos int) string {
	if !strings.Contains(holder.text, "\n") {
		return holder.text
	}
	indent := lineIndent(d.text, pos)
	lines := strings.Split(holder.text, "\n")
	for i := 1; i < len(lines); i++ {
		if strings.HasPrefix(lines[i], holder.indent) {
			lines[i] = indent + lines[i][len(holder.indent):]
		}
	}
	return strings.Join(lines, "\n")
}

// apply writes the edits into the formatted text.
func (d *decoder) apply() (string, error) {
	edits := slices.Clone(d.edits)
	slices.SortStableFunc(edits, compareEdits)
	var out strings.Builder
	cursor := 0
	for _, ed := range edits {
		if ed.pos < cursor {
			line, column := lineColumn(d.text, ed.pos)
			return "", fmt.Errorf("vibelang format: internal error: overlapping edits at %d:%d of the formatted TypeScript", line, column)
		}
		if replaced := d.text[ed.pos:ed.end]; hasComment(replaced) {
			line, column := lineColumn(d.text, ed.pos)
			return "", fmt.Errorf("vibelang format: internal error: the formatter moved a comment into VibeLang syntax at %d:%d", line, column)
		}
		out.WriteString(d.text[cursor:ed.pos])
		out.WriteString(ed.text)
		cursor = ed.end
	}
	out.WriteString(d.text[cursor:])
	return out.String(), nil
}
