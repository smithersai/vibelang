package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Two top-level is patterns that bind one name in one lexical home redeclare
// it, as two let declarations do, and TypeScript reports what such a let
// reports: TS2451 beside another lexical declaration, TS2300 beside a
// parameter (chapter 004, decided detail 245). The parser hoists each binding
// as a let of its home (parser.hoistDeclaration), so the binder reports the
// duplicate where the pattern wrote the name. The diagnostic offers to rename
// the later binding and its uses, and vibelang --fix applies that rename:
// under the previous release each if head was its own scope, so code written
// for it migrates mechanically (007 Codemods).
//
// A positive if head used to own a statement-local binding: its condition
// tail and then branch read that binding, while its else branch and following
// statements still read an outer parameter or local. Recover that ownership
// before renaming; current symbol resolution alone sees the duplicate home
// declarations and cannot distinguish these reads. A shorthand binding, { let id },
// keeps its key: it becomes { id: let id2 }. The new name is the name with the
// smallest number that no identifier of the file uses.

// isBindingRenameLabel is the rewrite kind --fix reports for the renames.
const isBindingRenameLabel = "is-binding renames"

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2451, 2300}, GetCodeActions: bindingRenameActions})
	checker.RegisterBindDiagnosticsFilterHook(explainBindingRename)
}

// bindingRenameNote is the line under TypeScript's redeclaration report at an
// is binding: the report points at the quick fix (chapter 004, decided detail
// 245). {0} is the name.
const bindingRenameNote = "Two is patterns bind {0} in one block: the quick fix renames the later binding and its uses, and vibelang --fix applies it; or use distinct names or separate blocks."

// explainBindingRename adds bindingRenameNote under each TS2451 or TS2300 at
// a later is binding's name or at the declaration it repeats. The binder's
// diagnostics are the file's, shared by every checker, so a diagnostic that
// already carries the note keeps one.
func explainBindingRename(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
	if !strings.HasSuffix(file.FileName().AsString(), ".vibe") {
		return ds
	}
	var renames []bindingRename
	found := false
	for _, d := range ds {
		if d.Source() != "" || d.Code() != 2451 && d.Code() != 2300 || d.File() != file || hasBindingRenameNote(d) {
			continue
		}
		if !found {
			renames, found = bindingRenames(c, file), true
		}
		for _, r := range renames {
			if r.at(file, d.Loc()) {
				note(d, bindingRenameNote, r.name.Text())
				break
			}
		}
	}
	return ds
}

func hasBindingRenameNote(d *ast.Diagnostic) bool {
	for _, chained := range d.MessageChain() {
		if strings.Contains(chained.MessageText(), "the quick fix renames the later binding") {
			return true
		}
	}
	return false
}

// A bindingRename is the rename of one later is binding and its uses.
type bindingRename struct {
	name    *ast.Node    // the later binding's name, where the pattern wrote it
	first   *ast.Node    // the declaration the name resolves to instead
	code    int32        // 2451, or 2300 beside a parameter
	newName string       // the name the rename writes
	edits   []sourceEdit // the binding, then each later use, in source order
}

// description names the fix.
func (r bindingRename) description() string {
	return "Rename the later binding " + r.name.Text() + " and its uses to " + r.newName
}

// at reports whether span lies in the later binding's name or the first
// declaration's name: TypeScript reports the duplicate at both.
func (r bindingRename) at(file *ast.SourceFile, span core.TextRange) bool {
	in := func(node *ast.Node) bool {
		return node != nil && nodeStart(file, node) <= span.Pos() && span.End() <= node.End()
	}
	return in(r.name) || in(r.first.Name())
}

// bindingRenames returns, in source order, the later is bindings of file
// whose name a declaration of their home already declares. When three or
// more patterns bind one name, each later binding takes the reads up to the
// next later binding, so one round renames them all to distinct names.
func bindingRenames(c *checker.Checker, file *ast.SourceFile) []bindingRename {
	var declarations []*ast.Node
	var taken []string
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			taken = append(taken, node.Text())
		}
		if ast.IsVariableDeclaration(node) && node.Flags&ast.NodeFlagsVibeLangIsBinding != 0 {
			declarations = append(declarations, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	slices.Sort(taken)
	taken = slices.Compact(taken)
	type later struct {
		declaration *ast.Node
		visible     *ast.Symbol
	}
	var laters []later
	for _, declaration := range declarations {
		name := declaration.Name()
		if name == nil || !ast.IsIdentifier(name) || declaration.Parent == nil || declaration.Parent.Parent == nil {
			continue
		}
		own := c.GetSymbolAtLocation(name)
		visible := c.ResolveName(name.Text(), declaration, ast.SymbolFlagsValue, true)
		if own == nil || visible == nil || visible == own || visible.ValueDeclaration() == nil || visible.ValueDeclaration() == declaration {
			continue // the first of its name, or no duplicate
		}
		first := visible.ValueDeclaration()
		if first.Name() == nil || nodeStart(file, first.Name()) >= nodeStart(file, name) {
			continue // the binding came first; the later declaration is not an is binding
		}
		laters = append(laters, later{declaration, visible})
	}
	slices.SortStableFunc(laters, func(a, b later) int {
		return nodeStart(file, a.declaration.Name()) - nodeStart(file, b.declaration.Name())
	})
	var out []bindingRename
	for i, l := range laters {
		name := l.declaration.Name()
		limit := l.declaration.Parent.Parent.Parent.End() // the home
		for _, next := range laters[i+1:] {
			if next.visible == l.visible {
				limit = nodeStart(file, next.declaration.Name())
				break
			}
		}
		code := int32(2451)
		first := l.visible.ValueDeclaration()
		if ast.IsParameterDeclaration(first) {
			code = 2300
		}
		r := bindingRename{name: name, first: first, code: code, newName: uniqueName(name.Text(), taken)}
		taken = append(taken, r.newName)
		r.edits = bindingRenameEdits(c, file, l.declaration, l.visible, r.newName, limit)
		out = append(out, r)
	}
	return out
}

// bindingRenameEdits writes newName for the binding declaration declares and
// for each owned read after it and before limit that resolves to visible.
// Positive if heads retain their previous statement-local ownership so a
// migration never captures an outer fallback (VIP-7, decided detail 245).
func bindingRenameEdits(c *checker.Checker, file *ast.SourceFile, declaration *ast.Node, visible *ast.Symbol, newName string, limit int) []sourceEdit {
	text := file.Text()
	name := declaration.Name()
	start, end := nodeStart(file, name), name.End()
	var edits []sourceEdit
	if keyword, ok := shorthandBindingKeyword(text, start); ok {
		// { let id } names its key by the binding: keep the key, rename the binding.
		edits = append(edits, sourceEdit{keyword, end, name.Text() + ": " + text[keyword:start] + newName})
	} else {
		edits = append(edits, sourceEdit{start, end, newName})
	}
	home := declaration.Parent.Parent.Parent // declaration list, statement, home
	var uses func(node *ast.Node) bool
	uses = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed == 0 && node.Text() == name.Text() && node.End() > end {
			useStart := nodeStart(file, node)
			if useStart < limit && text[useStart:node.End()] == name.Text() {
				switch {
				case ast.IsShorthandPropertyAssignment(node.Parent) && node.Parent.Name() == node:
					if c.GetShorthandAssignmentValueSymbol(node.Parent) == visible {
						edits = append(edits, sourceEdit{useStart, node.End(), name.Text() + ": " + newName})
					}
				case c.GetSymbolAtLocation(node) == visible:
					edits = append(edits, sourceEdit{useStart, node.End(), newName})
				}
			}
		}
		return node.ForEachChild(uses)
	}
	if condition, then := legacyBindingRenameScope(home, name); condition != nil {
		uses(condition)
		uses(then)
	} else {
		home.ForEachChild(uses)
	}
	slices.SortStableFunc(edits, func(a, b sourceEdit) int { return a.start - b.start })
	var distinct []sourceEdit
	for _, e := range edits {
		if len(distinct) == 0 || e.start >= distinct[len(distinct)-1].end {
			distinct = append(distinct, e)
		}
	}
	return distinct
}

// legacyBindingRenameScope recognizes the old positive if/&& form. The
// parser retains the source range of its is holder after lowering its tests.
// A negation, disjunction or another expression wrapper is not this old form;
// newly admitted homes continue to use their normal lexical ownership.
func legacyBindingRenameScope(home, name *ast.Node) (condition, then *ast.Node) {
	var positive func(*ast.Node) bool
	positive = func(node *ast.Node) bool {
		if node == nil {
			return false
		}
		node = ast.SkipParentheses(node)
		if !ast.IsBinaryExpression(node) {
			return false
		}
		binary := node.AsBinaryExpression()
		if binary.OperatorToken.Kind == ast.KindAmpersandAmpersandToken {
			return positive(binary.Left) || positive(binary.Right)
		}
		// The holder and its structural tests use vibelangSpanning, not
		// Reparsed, and inner ranges cover only the is token. Recognize the
		// generated (binding = value, true) step by its synthetic target,
		// whose range identifies this exact pattern declaration.
		if binary.OperatorToken.Kind != ast.KindCommaToken || binary.Right.Kind != ast.KindTrueKeyword || binary.Right.Flags&ast.NodeFlagsReparsed == 0 {
			return false
		}
		assignment := ast.SkipParentheses(binary.Left)
		if !ast.IsBinaryExpression(assignment) || assignment.AsBinaryExpression().OperatorToken.Kind != ast.KindEqualsToken {
			return false
		}
		target := assignment.AsBinaryExpression().Left
		return ast.IsIdentifier(target) && target.Flags&ast.NodeFlagsReparsed != 0 && target.Text() == name.Text() && target.Loc == name.Loc
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIfStatement(node) && node.Flags&ast.NodeFlagsReparsed == 0 && positive(node.Expression()) {
			condition, then = node.Expression(), node.AsIfStatement().ThenStatement
			return true
		}
		return node.ForEachChild(visit)
	}
	home.ForEachChild(visit)
	return condition, then
}

// shorthandBindingKeyword returns where the let or const keyword before the
// binding name at start begins when the binding is an object pattern's
// shorthand field, { let id } or { x: 1, const id }, whose key is the name;
// an explicit key, { id: let id }, a bare binding, an array element or an
// extractor argument is not.
func shorthandBindingKeyword(text string, start int) (int, bool) {
	i := skipTriviaBackwards(text, start)
	var keyword int
	switch {
	case strings.HasSuffix(text[:i], "const"):
		keyword = i - len("const")
	case strings.HasSuffix(text[:i], "let"):
		keyword = i - len("let")
	default:
		return 0, false
	}
	if keyword > 0 && isIdentifierByte(text[keyword-1]) {
		return 0, false
	}
	j := skipTriviaBackwards(text, keyword)
	if j == 0 {
		return 0, false
	}
	switch text[j-1] {
	case '{':
		return keyword, true
	case ',':
		return keyword, nearestOpener(text, j-1) == '{'
	}
	return 0, false
}

// skipTriviaBackwards returns the end of the token before position end,
// skipping spaces, newlines, block comments and line comments.
func skipTriviaBackwards(text string, end int) int {
	for end > 0 {
		switch {
		case text[end-1] == ' ' || text[end-1] == '\t' || text[end-1] == '\r':
			end--
		case text[end-1] == '\n':
			end--
			line := strings.LastIndexByte(text[:end], '\n') + 1
			if comment := strings.Index(text[line:end], "//"); comment >= 0 {
				end = line + comment
			}
		case strings.HasSuffix(text[:end], "*/"):
			open := strings.LastIndex(text[:end-2], "/*")
			if open < 0 {
				return end
			}
			end = open
		default:
			return end
		}
	}
	return end
}

// nearestOpener returns the bracket that is open at position end, scanning
// back over balanced pairs, or 0.
func nearestOpener(text string, end int) byte {
	depth := 0
	for i := end - 1; i >= 0; i-- {
		switch text[i] {
		case ')', ']', '}':
			depth++
		case '(', '[', '{':
			if depth == 0 {
				return text[i]
			}
			depth--
		}
	}
	return 0
}

func isIdentifierByte(b byte) bool {
	return b == '_' || b == '$' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= 0x80
}

// bindingRenameActions offers the rename at either report of the duplicate.
func bindingRenameActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if !strings.HasSuffix(fix.SourceFile.FileName().AsString(), ".vibe") {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	for _, r := range bindingRenames(c, fix.SourceFile) {
		if !r.at(fix.SourceFile, fix.Span) {
			continue
		}
		var changes []*lsproto.TextEdit
		for _, e := range r.edits {
			changes = append(changes, replaceRange(fix, e.start, e.end, e.text)...)
		}
		return []*ls.CodeAction{{Description: r.description(), Changes: changes}}, nil
	}
	return nil, nil
}

// bindingRenameMigrationFixes proposes each later binding's rename; one whose
// edits overlap a rename taken waits for a round that rechecks the edited
// source.
func bindingRenameMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	if !strings.HasSuffix(file.FileName().AsString(), ".vibe") {
		return p
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var taken []sourceEdit
	for _, r := range bindingRenames(c, file) {
		line, _ := scannerLineOf(file, nodeStart(file, r.name))
		key := "isBindingRename:" + r.name.Text() + ":" + strconv.Itoa(line+1)
		if refused[key] || slices.ContainsFunc(r.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			continue
		}
		p.fixes = append(p.fixes, fileFix{code: r.code, edits: r.edits, key: key, label: isBindingRenameLabel})
		taken = append(taken, r.edits...)
	}
	return p
}
