package vibelang

import (
	"context"
	"regexp"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// TypeScript-style Effect code in a .vibe file (D284-D291). Each rule finds a
// construct written the way Effect's TypeScript writes it where VibeLang has
// its own form, reports it as a warning, and offers a quick fix that writes
// the VibeLang form when the rewrite keeps the program's meaning:
//
//	EK4830  class X extends Data.TaggedError("X")<{ … }> {}   error X { … }
//	EK4831  class X extends Context.Service<X, { … }>()("k")  service X { … }
//	EK4832  const X = Schema.Struct({ … })                    schema X { … }
//	EK4833  Effect.Effect<A, E, R>                            A!E!R
//	EK4834  Effect.succeed(x), Effect.fail(e) where they run  x, throw e
//	EK4835  Effect.catchTag, catchTags, catch                 x catch (e) => match (e) { … }
//	EK4836  Effect.withSpan, provide, provideService          withSpan(() => p, "n"), provide L { … }
//	EK4837  class X extends Schema.TaggedError<X>()("X", { … })  schema error X { … }
//
// The rules are lint (D241): adjustable in the vibelang setting diagnostics,
// silenced for one line by @vibelang-diagnostics-next-line, warnings by
// default, and never errors that change emit or the exit status. The plan of
// each rewrite is computed once and serves the check, which words the
// warning by whether a fix exists, the editor's quick fix, and vibelang --fix
// (fix.go), which applies every fix in tsFormFixCodes.

var (
	// EK4830 (D284): a class that Effect's TypeScript writes for a tagged error. {0} is the class, {1} its base.
	EK4830 = message(4830, warningCategory, "{0} extends {1}; in VibeLang an error is an error declaration: error {0} { … }.")
	// EK4831 (D285): a Context.Service class. {0} is the class.
	EK4831 = message(4831, warningCategory, "{0} extends Context.Service; in VibeLang a service is a service declaration: service {0} { … }.")
	// EK4832 (D286): a constant that holds a Schema.Struct. {0} is the constant.
	EK4832 = message(4832, warningCategory, "{0} holds a Schema.Struct; a schema declaration writes the struct and its type at once: schema {0} { … }.")
	// EK4833 (D287, D308, D309): an Effect type written through the Effect module. {0} is the type, {1} the ! form.
	EK4833 = message(4833, warningCategory, "{0} is TypeScript's spelling of an Effect type; write {1}.")
	// EK4834 (D288): Effect.succeed or Effect.fail where the call runs. {0} is the call, {1} the direct form.
	EK4834 = message(4834, warningCategory, "{0} runs here, so it is its value: write {1}.")
	// EK4835 (D289): a catch combinator. {0} is the combinator.
	EK4835 = message(4835, warningCategory, "{0} catches by tag; write a catch expression that matches on the failure: x catch (e) => match (e) { … }.")
	// EK4836 (D290): a combinator that a VibeLang block form writes. {0} is the combinator, {1} the block form.
	EK4836 = message(4836, warningCategory, "{0} wraps a program in a call; write it as a block: {1}.")
	// EK4837 (D284): a Schema error class, which a schema error declaration writes with its Schema. {0} is the class.
	EK4837 = message(4837, warningCategory, "{0} extends Schema.TaggedError; a schema error declaration, schema error {0} { … }, writes the same failure with its Schema.")
)

// tsFormMessages are the rules' messages, in code order.
var tsFormMessages = []*Message{EK4830, EK4831, EK4832, EK4833, EK4834, EK4835, EK4836, EK4837}

func init() {
	for _, m := range tsFormMessages {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkTypeScriptForms)
	ls.RegisterCodeFixProvider(typeScriptFormFix)
}

// A sourceEdit replaces the text from start to end of one file.
type sourceEdit struct {
	start, end int
	text       string
}

// A formRewrite is a rule's plan for one construct: the edits that write the
// VibeLang form, or none when the construct has no exact rewrite. why, when
// set, is the note that explains a missing fix; note, the note under a
// warning that has one.
type formRewrite struct {
	edits       []sourceEdit
	description string
	why         string
	message     *Message // the warning's text, when not the rule's
}

// fixable reports whether r has a fix.
func (r *formRewrite) fixable() bool {
	return r != nil && len(r.edits) > 0
}

// A tsFormRule is one of the rules above: it finds its constructs in a file
// and plans the rewrite of one.
type tsFormRule struct {
	message *Message
	// find calls report for each construct in file, with the node the
	// diagnostic stands at and the plan of its rewrite.
	find func(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any))
	// plan plans the rewrite of the construct whose diagnostic stands at node.
	plan func(c *checker.Checker, file *ast.SourceFile, at *ast.Node) *formRewrite
	// diagnosed reports whether node is a node this rule's diagnostics stand at.
	diagnosed func(node *ast.Node) bool
}

// tsFormRules are registered by the rules' files.
var tsFormRules = map[int32]*tsFormRule{}

// tsFormFixCodes are the codes whose quick fixes vibelang --fix applies
// (D291): the rules above, whose fixes keep the program's meaning, and the
// retired spellings whose fixes write the current ones (D172, D219, D221,
// D223).
var tsFormFixCodes = []int32{4830, 4831, 4832, 4833, 4834, 4835, 4836, 4837, 2112, 2113, 2120, 2121}

// checkTypeScriptForms reports the rules' warnings in file.
func checkTypeScriptForms(c *checker.Checker, file *ast.SourceFile) {
	for _, m := range tsFormMessages {
		rule := tsFormRules[m.Code]
		if rule == nil {
			continue
		}
		rule.find(c, file, func(at *ast.Node, rewrite *formRewrite, args ...any) {
			if m.Code == 4834 || m.Code == 4835 {
				a := analyzerFor(c)
				for parent := at.Parent; parent != nil; parent = parent.Parent {
					if ast.IsCallExpression(parent) && a.legacyPipeFirst(parent) != nil {
						return
					}
				}
			}
			rewrite = preserveRewriteComments(file, rewrite)
			m := rule.message
			if rewrite != nil && rewrite.message != nil {
				m = rewrite.message
			}
			d := reportAt(c, file, tsFormSpan(file, at), m, args...)
			if rewrite.fixable() {
				note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", rewrite.description)
			}
			if rewrite != nil && rewrite.why != "" {
				note(d, "{0}", rewrite.why)
			}
		})
	}
}

// tsFormSpan is the span of a rule's diagnostic at node: its text without
// leading trivia.
func tsFormSpan(file *ast.SourceFile, node *ast.Node) core.TextRange {
	return core.NewTextRange(nodeStart(file, node), node.End())
}

// tsFormNodeAt returns the node of file whose span is span and that test
// accepts.
func tsFormNodeAt(file *ast.SourceFile, span core.TextRange, test func(node *ast.Node) bool) *ast.Node {
	var found *ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found != nil || node.End() < span.Pos() || node.Pos() > span.End() {
			return found != nil
		}
		if nodeStart(file, node) == span.Pos() && node.End() == span.End() && test(node) {
			found = node
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// typeScriptFormFix is the quick fix of every rule.
var typeScriptFormFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{4830, 4831, 4832, 4833, 4834, 4835, 4836, 4837},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		rule := tsFormRules[fix.ErrorCode]
		if rule == nil {
			return nil, nil
		}
		at := tsFormNodeAt(fix.SourceFile, fix.Span, rule.diagnosed)
		if at == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		// Import cleanup reads runtime alias references collected by the
		// complete file check, including for editor requests with supplied diagnostics.
		c.GetDiagnostics(ctx, fix.SourceFile)
		rewrite := preserveRewriteComments(fix.SourceFile, rule.plan(c, fix.SourceFile, at))
		if !rewrite.fixable() {
			return nil, nil
		}
		var changes []*lsproto.TextEdit
		for _, edit := range rewrite.edits {
			changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
		}
		return []*ls.CodeAction{{Description: "Write " + rewrite.description, Changes: changes}}, nil
	},
}

// withImportRemovals adds to r's edits the removal of every import binding
// whose only uses in file lie in the ranges r's edits replace: a rewrite that
// drops the last use of Data or Context drops its import too.
func withImportRemovals(c *checker.Checker, file *ast.SourceFile, r *formRewrite) *formRewrite {
	if !r.fixable() {
		return r
	}
	var replaced []core.TextRange
	var written []string
	for _, edit := range r.edits {
		replaced = append(replaced, core.NewTextRange(edit.start, edit.end))
		written = append(written, edit.text)
	}
	cleanup, why := importRemovalEdits(c, file, replaced, nil, written...)
	if why != "" {
		return &formRewrite{why: why}
	}
	r.edits = append(r.edits, cleanup...)
	return r
}

// The conservative check also treats comment-looking text in literals as
// comments. It may refuse an ambiguous edit, but never discards documentation.
var rewriteComments = regexp.MustCompile(`(?s)/\*.*?\*/|//[^\r\n]*`)

func editsPreserveComments(text string, edits []sourceEdit) bool {
	for _, edit := range edits {
		if !slices.Equal(rewriteComments.FindAllString(text[edit.start:edit.end], -1), rewriteComments.FindAllString(edit.text, -1)) {
			return false
		}
	}
	return true
}

func preserveRewriteComments(file *ast.SourceFile, rewrite *formRewrite) *formRewrite {
	if rewrite.fixable() && !editsPreserveComments(file.Text(), rewrite.edits) {
		return &formRewrite{message: rewrite.message, why: "No quick fix: this rewrite cannot preserve its comments."}
	}
	return rewrite
}

// An importBinding is one local name an import declaration binds.
type importBinding struct {
	name        string
	declaration *ast.Node // the import declaration
	node        *ast.Node // the binding's own node: a specifier, a namespace import, or the default name
}

// importBindingsOf lists the value import bindings of file.
func importBindingsOf(file *ast.SourceFile) []importBinding {
	var bindings []importBinding
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || statement.ImportClause() == nil {
			continue
		}
		clause := statement.ImportClause().AsImportClause()
		if name := clause.Name(); name != nil {
			bindings = append(bindings, importBinding{name.Text(), statement, name})
		}
		switch named := clause.NamedBindings; {
		case named == nil:
		case ast.IsNamespaceImport(named):
			bindings = append(bindings, importBinding{named.Name().Text(), statement, named})
		case ast.IsNamedImports(named):
			for _, element := range named.Elements() {
				bindings = append(bindings, importBinding{element.Name().Text(), statement, element})
			}
		}
	}
	return bindings
}

// identifierUses counts, for each name in names, the identifiers of file
// outside import declarations, split by whether they lie in replaced. A
// rewrite candidate asks once per fix, so the identifiers come from index,
// which lists them once per file; a nil index walks file.
func identifierUses(file *ast.SourceFile, index identifierIndex, names map[string]bool, replaced []core.TextRange) (inside, outside map[string]int) {
	if index == nil {
		index = indexIdentifiers(file)
	}
	inside, outside = map[string]int{}, map[string]int{}
	in := func(pos int) bool {
		return slices.ContainsFunc(replaced, func(r core.TextRange) bool { return r.Pos() <= pos && pos < r.End() })
	}
	for name := range names {
		for _, at := range index[name] {
			if in(at.pos) || in(at.start) {
				inside[name]++
			} else {
				outside[name]++
			}
		}
	}
	return inside, outside
}

// An identifierIndex lists, by text, where the identifiers of one file stand
// outside its import declarations.
type identifierIndex map[string][]identifierAt

// identifierAt is where one identifier stands: its pos, and its start after
// leading trivia.
type identifierAt struct{ pos, start int }

// indexIdentifiers walks file once and returns its identifierIndex.
func indexIdentifiers(file *ast.SourceFile) identifierIndex {
	index := identifierIndex{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsImportDeclaration(node) {
			return false
		}
		if ast.IsIdentifier(node) {
			index[node.Text()] = append(index[node.Text()], identifierAt{node.Pos(), nodeStart(file, node)})
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return index
}

type identifierIndexKey struct{}

// identifierIndexOf returns file's identifierIndex, built once per checker,
// or nil without a checker.
func identifierIndexOf(c *checker.Checker, file *ast.SourceFile) identifierIndex {
	if c == nil {
		return nil
	}
	indexes := c.ExtensionState(identifierIndexKey{}, func() any { return map[*ast.SourceFile]identifierIndex{} }).(map[*ast.SourceFile]identifierIndex)
	if index, ok := indexes[file]; ok {
		return index
	}
	index := indexIdentifiers(file)
	indexes[file] = index
	return index
}

// unusedImportEdits returns the edits that remove each import binding of file
// that has uses in replaced and none elsewhere, or, when used is not nil, each
// binding that used counts and file no longer uses at all. A declaration that
// loses every binding keeps its module initialization unless it was type-only
// or names Effect itself, whose modules the prelude already supplies.
func unusedImportEdits(file *ast.SourceFile, replaced []core.TextRange, used map[string]int, written ...string) []sourceEdit {
	// The final cleanup uses this only for Effect's prelude modules.
	edits, _ := importRemovalEdits(nil, file, replaced, used, written...)
	return edits
}

// importRemovalEdits preserves whether each dependency was initialized before
// the rewrite. A syntactic value import may be erased when used only as a type;
// conversely, surviving type bindings do not preserve a removed value's load.
func importRemovalEdits(c *checker.Checker, file *ast.SourceFile, replaced []core.TextRange, used map[string]int, written ...string) ([]sourceEdit, string) {
	bindings := importBindingsOf(file)
	names := map[string]bool{}
	for _, b := range bindings {
		names[b.name] = true
	}
	inside, outside := identifierUses(file, identifierIndexOf(c, file), names, replaced)
	for name := range names {
		// A name the rewrite writes again, such as one in an argument it
		// keeps, stays used.
		for _, text := range written {
			if containsWord(text, name) {
				outside[name]++
			}
		}
	}
	unused := map[*ast.Node]bool{}
	for _, b := range bindings {
		if outside[b.name] > 0 {
			continue
		}
		if used != nil && used[b.name] > 0 || used == nil && inside[b.name] > 0 {
			unused[b.node] = true
		}
	}
	if len(unused) == 0 {
		return nil, ""
	}
	text := file.Text()
	var edits []sourceEdit
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) {
			continue
		}
		var all, gone []*ast.Node
		for _, b := range bindings {
			if b.declaration == statement {
				all = append(all, b.node)
				if unused[b.node] {
					gone = append(gone, b.node)
				}
			}
		}
		if len(gone) == 0 {
			continue
		}
		start, end := nodeStart(file, statement), statement.End()
		module := statement.ModuleSpecifier()
		custom := module.Text() != "effect" && !strings.HasPrefix(module.Text(), "effect/")
		loaded := false
		if custom {
			clause := statement.ImportClause().AsImportClause()
			if clause.PhaseModifier == ast.KindDeferKeyword {
				return nil, "No quick fix: a deferred import's initialization timing must be preserved."
			}
			if c == nil {
				return nil, "No quick fix: its import initialization cannot be proved."
			}
			// Under verbatimModuleSyntax, even import { type T } emits an
			// empty value import; only an import type clause is erased.
			loaded = c.CompilerOptions().VerbatimModuleSyntax.IsTrue() && !clause.IsTypeOnly()
			for _, binding := range all {
				if clause.IsTypeOnly() || ast.IsImportSpecifier(binding) && binding.AsImportSpecifier().IsTypeOnly {
					continue
				}
				if c.CompilerOptions().VerbatimModuleSyntax.IsTrue() {
					continue
				}
				name := binding.Name()
				if name == nil {
					name = binding // a default import's identifier
				}
				value, known := c.ImportBindingValueReference(name)
				if !known {
					return nil, "No quick fix: its import initialization cannot be proved."
				}
				loaded = loaded || value
			}
		}
		bare := "import " + expressionText(file, module) + text[module.End():end]
		if len(gone) == len(all) {
			if custom && loaded {
				edits = append(edits, sourceEdit{start, end, bare})
				continue
			}
			if newline := strings.IndexByte(text[end:], '\n'); newline >= 0 && strings.TrimSpace(text[end:end+newline]) == "" {
				end += newline + 1
			}
			edits = append(edits, sourceEdit{start, end, ""})
			continue
		}
		if custom && loaded {
			// Some surviving names may be type-only after rewriting. An
			// explicit dependency retains the original module edge regardless
			// of binding elision; ESM initializes duplicate imports only once.
			edits = append(edits, sourceEdit{start, start, bare + "\n" + lineIndent(text, start)})
		}
		edits = append(edits, bindingRemovals(file, statement, gone)...)
	}
	return edits, ""
}

// bindingRemovals returns the edits that remove gone, bindings of the import
// declaration statement that keeps others. Removing two names of one braced
// list one at a time would overlap at the comma between them, so a list that
// loses more than one name is written again with the names it keeps, in their
// order and with the separator it had.
func bindingRemovals(file *ast.SourceFile, statement *ast.Node, gone []*ast.Node) []sourceEdit {
	named := statement.ImportClause().AsImportClause().NamedBindings
	var removed []*ast.Node
	for _, node := range gone {
		if named != nil && ast.IsNamedImports(named) && node.Parent == named {
			removed = append(removed, node)
		}
	}
	if len(removed) < 2 {
		var edits []sourceEdit
		for _, node := range gone {
			edits = append(edits, bindingRemoval(file, node))
		}
		return edits
	}
	elements := named.Elements()
	var kept []string
	for _, element := range elements {
		if !slices.Contains(removed, element) {
			kept = append(kept, nodeText(file, element))
		}
	}
	text := file.Text()
	first, last := nodeStart(file, elements[0]), elements[len(elements)-1].End()
	separator := ", "
	if strings.ContainsAny(text[first:last], "\n") {
		separator = ",\n" + lineIndent(text, first)
	}
	edits := []sourceEdit{{first, last, strings.Join(kept, separator)}}
	for _, node := range gone {
		if !slices.Contains(removed, node) {
			edits = append(edits, bindingRemoval(file, node))
		}
	}
	return edits
}

// containsWord reports whether text holds word as a whole identifier. The
// empty word, the name of a binding error recovery left without one, is none.
func containsWord(text, word string) bool {
	if word == "" {
		return false
	}
	isPart := func(b byte) bool {
		return b == '_' || b == '$' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= 0x80
	}
	for i := strings.Index(text, word); i >= 0; {
		end := i + len(word)
		if (i == 0 || !isPart(text[i-1])) && (end == len(text) || !isPart(text[end])) {
			return true
		}
		next := strings.Index(text[i+1:], word)
		if next < 0 {
			return false
		}
		i += 1 + next
	}
	return false
}

// bindingRemoval returns the edit that removes node, one binding of an import
// declaration that keeps others, with the comma that separates it.
func bindingRemoval(file *ast.SourceFile, node *ast.Node) sourceEdit {
	text := file.Text()
	start, end := nodeStart(file, node), node.End()
	after := scanner.SkipTrivia(text, end)
	if after < len(text) && text[after] == ',' {
		return sourceEdit{start, scanner.SkipTrivia(text, after+1), ""}
	}
	// The last binding: remove the comma before it.
	before := strings.LastIndexByte(text[:start], ',')
	if before >= 0 && strings.TrimSpace(text[before+1:start]) == "" {
		return sourceEdit{before, end, ""}
	}
	if ast.IsImportClause(node.Parent) {
		// A default import before named bindings: import X, { a } from …
		comma := strings.IndexByte(text[end:], ',')
		if comma >= 0 {
			return sourceEdit{start, scanner.SkipTrivia(text, end+comma+1), ""}
		}
	}
	return sourceEdit{start, end, ""}
}

// needsOperandParentheses reports whether node, an expression, must be
// parenthesized where a primary expression is expected, such as before a
// member access or a call's argument list.
func needsOperandParentheses(node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	switch node.Kind {
	case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression,
		ast.KindThisKeyword, ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindNoSubstitutionTemplateLiteral,
		ast.KindTemplateExpression, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword, ast.KindArrayLiteralExpression,
		ast.KindNewExpression, ast.KindTaggedTemplateExpression:
		return false
	}
	return true
}

// isSynthesizedPosition reports whether parent, the parent of a node a rule
// rewrites, is a node the parser wrote for a VibeLang form rather than the
// source: a synthesized node, an arrow function whose => it synthesized, or
// a call of a runtime helper such as $catchExpression.
func isSynthesizedPosition(parent *ast.Node) bool {
	if parent == nil || parent.Flags&ast.NodeFlagsReparsed != 0 {
		return true
	}
	if ast.IsArrowFunction(parent) {
		if token := parent.AsArrowFunction().EqualsGreaterThanToken; token == nil || token.Flags&ast.NodeFlagsReparsed != 0 {
			return true
		}
	}
	return ast.IsCallExpression(parent) && isHelperCall(parent)
}

// shortText returns text for a message, or otherwise when it is long or
// spans lines.
func shortText(text, otherwise string) string {
	if len(text) > 60 || strings.ContainsAny(text, "\r\n") {
		return otherwise
	}
	return text
}

// expressionText returns node's source text without leading trivia.
func expressionText(file *ast.SourceFile, node *ast.Node) string {
	return nodeText(file, node) // "" for a node the parser left out, which a file with syntax errors has
}

// effectMember returns the module and the name of the effect export that
// expression names, such as Schema and Array for Schema.Array. A member of a
// module is named as written, since a module may export a declaration under
// another name (Schema exports ArraySchema as Array).
func effectMember(c *checker.Checker, expression *ast.Node) (module string, name string) {
	if ast.IsPropertyAccessExpression(expression) && ast.IsIdentifier(expression.Name()) {
		if module := effectModuleOf(c, expression.Expression()); module != "" {
			return module, expression.Name().Text()
		}
	}
	return effectFunctionOf(c, expression)
}

// isEffectFunction reports whether callee names module.name of effect, such as
// Effect.succeed. A member access whose name is none of names fails before
// the checker resolves anything.
func isEffectFunction(c *checker.Checker, callee *ast.Node, module string, names ...string) bool {
	if ast.IsPropertyAccessExpression(callee) && ast.IsIdentifier(callee.Name()) && !slices.Contains(names, callee.Name().Text()) {
		return false
	}
	m, name := effectMember(c, callee)
	return m == module && slices.Contains(names, name)
}

// runningText returns the text that runs node, a program a rewrite moves
// into a position where a call runs: node itself when it is an invocation,
// and node called when it is an Effect value. It returns false for any other
// node, which a rewrite cannot run.
func runningText(c *checker.Checker, file *ast.SourceFile, node *ast.Node) (string, bool) {
	return runningExpressionText(c, node, expressionText(file, node))
}

// thunkBody returns B when node is an arrow function, () => B, whose body B
// is a call: a call of the arrow in place runs B where it stands, so a
// rewrite writes load(id), not (() => load(id))(). It returns node otherwise,
// and for an arrow that declares parameters, type parameters or a return
// type, which B alone would drop.
func thunkBody(node *ast.Node) *ast.Node {
	arrow := ast.SkipParentheses(node)
	if !ast.IsArrowFunction(arrow) || len(arrow.Parameters()) > 0 || arrow.TypeParameters() != nil || arrow.Type() != nil || ast.HasSyntacticModifier(arrow, ast.ModifierFlagsAsync) {
		return node
	}
	if body := arrow.Body(); body != nil && !ast.IsBlock(body) && isInvocation(ast.SkipParentheses(body)) {
		return body
	}
	return node
}

// runningExpressionText is runningText with source text whose identifiers may
// have been hygienically renamed by a source rewrite.
func runningExpressionText(c *checker.Checker, node *ast.Node, text string) (string, bool) {
	if isInvocation(ast.SkipParentheses(node)) {
		return text, true
	}
	if t := c.GetTypeAtLocation(node); isEffectType(c, t) {
		if needsOperandParentheses(node) {
			text = "(" + text + ")"
		}
		return text + "()", true
	}
	return text, false
}
