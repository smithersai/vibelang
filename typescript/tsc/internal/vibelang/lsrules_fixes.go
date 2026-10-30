package vibelang

import (
	"context"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"weak"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// The quick fixes for the EK48xx rules (lsrules.go). Each finds the node
// that its diagnostic was reported at, the node whose error span is the
// diagnostic's, and rewrites the source around it.

// reportedNode returns the outermost node of file whose error span is span
// and that test accepts, or nil.
func reportedNode(file *ast.SourceFile, span core.TextRange, test func(node *ast.Node) bool) *ast.Node {
	var found *ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found != nil || node.End() < span.Pos() || node.Pos() > span.End() {
			return found != nil
		}
		if test(node) && scanner.GetErrorRangeForNode(file, node) == span {
			found = node
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// replaceRange returns one text edit that replaces the span from start to end.
func replaceRange(fix *ls.CodeFixContext, start, end int, text string) []*lsproto.TextEdit {
	return []*lsproto.TextEdit{{Range: fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(start, end)), NewText: text}}
}

// nodeStart returns where node's text starts, after its leading trivia.
func nodeStart(file *ast.SourceFile, node *ast.Node) int {
	return scanner.SkipTrivia(file.Text(), node.Pos())
}

// callEffectFix calls the Effect value that EK4801 or EK4802 reports, so
// that it runs: e becomes e(), and a + b becomes (a + b)().
var callEffectFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4801.Code, EK4802.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		value := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			parent := node.Parent
			switch {
			case ast.IsExpressionStatement(parent) && parent.Expression() == node:
				return inLowerableBody(parent)
			case ast.IsReturnStatement(parent):
				return true
			case ast.IsArrowFunction(parent):
				return parent.Body() == node
			case parent.Kind == ast.KindConditionalExpression:
				return parent.AsConditionalExpression().Condition != node // an arm EK4802 reports
			case ast.IsBinaryExpression(parent):
				return slices.Contains(returnedParts(parent), node)
			}
			return false
		})
		if value == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		some, all := analyzerFor(c).programMembers(c.GetTypeAtLocation(value))
		rejected := contractRejectsCall(c, value)
		done()
		uncallable := some && !all
		if uncallable {
			return nil, nil // a member of its union is no program, so calling it does not check
		}
		if rejected {
			return nil, nil
		}
		changes := replaceRange(fix, value.End(), value.End(), "()")
		if needsParentheses(value) {
			changes = append(replaceRange(fix, nodeStart(fix.SourceFile, value), nodeStart(fix.SourceFile, value), "("), replaceRange(fix, value.End(), value.End(), ")()")...)
		}
		return []*ls.CodeAction{{Description: "Call it to run it", Changes: changes}}, nil
	},
}

// contractRejectsCall reports whether calling value, an Effect, would run a
// failure or requirement, or for a returned value a success, that the
// written contract of its function does not accept: in
// `effect function f(): unknown!! { return Exit.fail("data") }` the call
// would fail with string, which E = never rejects (EK2001).
func contractRejectsCall(c *checker.Checker, value *ast.Node) bool {
	fn := ast.GetContainingFunction(value)
	if fn == nil || fn.Type() == nil {
		return false // an inferred contract takes in what the call runs
	}
	declared := analyzerFor(c).declaredProgramReturn(fn)
	valueType := c.GetTypeAtLocation(value)
	if declared == nil || !isEffectType(c, valueType) && !isEffectSubtype(c, valueType) {
		return false
	}
	channels := []string{"_E", "_R"}
	if !ast.IsExpressionStatement(value.Parent) {
		channels = append(channels, "_A")
	}
	for _, name := range channels {
		runs, accepts := programChannelType(c, valueType, name), programChannelType(c, declared, name)
		if runs == nil || accepts == nil || !c.IsTypeAssignableTo(runs, accepts) {
			return true
		}
	}
	return false
}

// mergeAllFix writes wire for the Layer.mergeAll that EK4807 reports.
var mergeAllFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4807.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		argument := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			return node.Parent != nil && ast.IsCallExpression(node.Parent) && node.Parent.Expression() != node
		})
		if argument == nil {
			return nil, nil
		}
		callee := argument.Parent.Expression()
		return []*ls.CodeAction{{
			Description: "Write wire for Layer.mergeAll",
			Changes:     replaceRange(fix, nodeStart(fix.SourceFile, callee), callee.End(), "wire"),
		}}, nil
	},
}

// assertionFix removes the assertion that EK4810 reports.
var assertionFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4810.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		assertion := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			return ast.IsAsExpression(node) || ast.IsTypeAssertion(node)
		})
		if assertion == nil {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Remove the assertion",
			Changes:     replaceRange(fix, nodeStart(fix.SourceFile, assertion), assertion.End(), scanner.GetTextOfNode(assertion.Expression())),
		}}, nil
	},
}

// outdatedAPIFix writes the Effect 4 name of the Effect 3 name that EK4813
// reports.
var outdatedAPIFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4813.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		return renameEffect3API(fix, reportedNode(fix.SourceFile, fix.Span, isEffect3Name)), nil
	},
}

// outdatedAPITypeScriptFix is outdatedAPIFix for a .ts file, where
// TypeScript's TS2339 reports an Effect 3 name of effect's Effect module.
var outdatedAPITypeScriptFix = &ls.CodeFixProvider{
	ErrorCodes: []int32{2339},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		name := reportedNode(fix.SourceFile, fix.Span, isEffect3Name)
		if name == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		if effectModuleOf(c, name.Parent.Expression()) != "Effect" {
			return nil, nil
		}
		return renameEffect3API(fix, name), nil
	},
}

// isEffect3Name reports whether node is the name of a property access that
// effect3API lists as renamed.
func isEffect3Name(node *ast.Node) bool {
	return ast.IsIdentifier(node) && node.Parent != nil && ast.IsPropertyAccessExpression(node.Parent) && node.Parent.Name() == node && effect3API[node.Text()].renamed != ""
}

// renameEffect3API returns the action that writes name's Effect 4 name.
func renameEffect3API(fix *ls.CodeFixContext, name *ast.Node) []*ls.CodeAction {
	if name == nil {
		return nil
	}
	renamed := effect3API[name.Text()].renamed
	module := scanner.GetTextOfNode(name.Parent.Expression())
	return []*ls.CodeAction{{
		Description: "Write " + module + "." + renamed,
		Changes:     replaceRange(fix, nodeStart(fix.SourceFile, name), name.End(), renamed),
	}}
}

// schemaIsFix writes Schema.is(S)(x) for the x instanceof S that EK4817
// reports.
var schemaIsFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4817.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		test := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			return ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindInstanceOfKeyword
		})
		if test == nil {
			return nil, nil
		}
		b := test.AsBinaryExpression()
		text := "Schema.is(" + scanner.GetTextOfNode(b.Right) + ")(" + scanner.GetTextOfNode(b.Left) + ")"
		return []*ls.CodeAction{{Description: "Test with Schema.is", Changes: replaceRange(fix, nodeStart(fix.SourceFile, test), test.End(), text)}}, nil
	},
}

// trustedValueFix moves D23 metadata into a value beside the implementation,
// retaining the original function for TypeScript callers (D249).
var trustedValueFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4406.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		callee := reportedNode(fix.SourceFile, fix.Span, func(n *ast.Node) bool {
			return ast.IsIdentifier(n) && n.Parent != nil && ast.IsCallExpression(n.Parent) && n.Parent.Expression() == n
		})
		if callee == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		plan := trustedValueEdits(c, fix.SourceFile, callee.Parent)
		if plan == nil {
			return nil, nil
		}
		edits := func(file *ast.SourceFile, replacements []trustedValueEdit) []*lsproto.TextEdit {
			var result []*lsproto.TextEdit
			for _, edit := range replacements {
				result = append(result, &lsproto.TextEdit{Range: fix.LS.ToLSPRange(file, core.NewTextRange(edit.start, edit.end)), NewText: edit.text})
			}
			return result
		}
		action := &ls.CodeAction{Description: "Export and call " + plan.name, Changes: edits(fix.SourceFile, plan.caller)}
		if len(plan.declaration) != 0 {
			action.AdditionalChanges = []ls.FileTextChanges{{URI: lsconv.FileNameToDocumentURI(tspath.RootedFilePath(plan.file.FileName())), Changes: edits(plan.file, plan.declaration)}}
		}
		return []*ls.CodeAction{action}, nil
	},
}

// trustedValueEdit is a replacement in one of the two migration documents.
type trustedValueEdit struct {
	start, end int
	text       string
}

// trustedValuePlan keeps document ranges separate until the LSP conversion.
type trustedValuePlan struct {
	file                *ast.SourceFile
	name                string
	declaration, caller []trustedValueEdit
}

// trustedValueEdits plans a value contract for a named imported function.
// Methods and declaration-only packages need a hand-written adapter: guessing
// a receiver or editing a package's declarations would change their meaning.
func trustedValueEdits(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *trustedValuePlan {
	callee := call.Expression()
	if !ast.IsIdentifier(callee) {
		return nil
	}
	t := callTrust(c, call)
	if t.kind != trustTagged || t.declaration == nil || t.unreachable != "" || t.promise {
		return nil
	}
	decl := t.declaration
	source := ast.GetSourceFileOfNode(decl)
	if source == nil || source == file || source.IsDeclarationFile || strings.Contains(string(source.FileName()), "/node_modules/") {
		return nil
	}
	var statement *ast.Node
	switch {
	case ast.IsFunctionDeclaration(decl):
		statement = decl
		if sym := decl.Symbol(); sym != nil {
			for _, overload := range sym.Declarations() {
				if ast.IsFunctionDeclaration(overload) && overload.End() > statement.End() {
					statement = overload
				}
			}
		}
	case ast.IsVariableDeclaration(decl):
		statement = ast.FindAncestorKind(decl, ast.KindVariableStatement)
	default:
		return nil
	}
	if statement == nil || statement.Parent != source.AsNode() || decl.Name() == nil || !ast.IsIdentifier(decl.Name()) {
		return nil
	}
	// Only a direct import gives the caller an unambiguous module to import
	// the new export from, including when it aliases the original function.
	sym := c.GetSymbolAtLocation(callee)
	if sym == nil || sym.Flags()&ast.SymbolFlagsAlias == 0 {
		return nil
	}
	var imported *ast.Node
	for _, d := range sym.Declarations() {
		if ast.IsImportSpecifier(d) {
			imported = ast.FindAncestorKind(d, ast.KindImportDeclaration)
			break
		}
	}
	if imported == nil {
		return nil
	}

	// A barrel can export the original function without exporting the new value.
	// Only edit a declaration reached through its own module.
	module := c.ResolveExternalModuleName(imported.ModuleSpecifier(), nil)
	direct := false
	if module != nil {
		for _, d := range module.Declarations() {
			direct = direct || ast.GetSourceFileOfNode(d) == source
		}
	}
	if !direct {
		return nil
	}
	fresh := func(base string, scope *ast.SourceFile) string {
		name := base
		for i := 2; c.ResolveName(name, scope.AsNode(), ast.SymbolFlagsValue|ast.SymbolFlagsType|ast.SymbolFlagsAlias, false) != nil; i++ {
			name = base + strconv.Itoa(i)
		}
		return name
	}
	plan := &trustedValuePlan{file: source}
	stem := decl.Name().Text()
	if !strings.HasSuffix(stem, "Trusted") {
		stem += "Trusted"
	}
	// Reuse only a wrapper with this implementation and these exact classes;
	// a similarly named user value must not silently change the contract.
	for _, stmt := range source.Statements.Nodes {
		if !ast.IsVariableStatement(stmt) || !ast.HasSyntacticModifier(stmt, ast.ModifierFlagsExport) {
			continue
		}
		for _, v := range stmt.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			if !ast.IsIdentifier(v.Name()) || !strings.HasPrefix(v.Name().Text(), stem) {
				continue
			}
			init := v.Initializer()
			if init == nil || !ast.IsCallExpression(init) || len(init.Arguments()) != 2 {
				continue
			}
			helper := trustedImportName(source, "trusted")
			args := init.Arguments()
			if helper == "" || !ast.IsIdentifier(init.Expression()) || init.Expression().Text() != helper || !ast.IsIdentifier(args[0]) || args[0].Text() != decl.Name().Text() || !ast.IsArrayLiteralExpression(args[1]) {
				continue
			}
			classes := args[1].Elements()
			if len(classes) != len(t.failures) {
				continue
			}
			same := true
			for i, f := range t.failures {
				same = same && ast.IsIdentifier(classes[i]) && classes[i].Text() == f.name
			}
			if same {
				plan.name = v.Name().Text()
				break
			}
		}
		if plan.name != "" {
			break
		}
	}
	if plan.name == "" {
		plan.name = fresh(stem, source)
		helper := trustedImportName(source, "trusted")
		if helper == "" {
			helper = fresh("trusted", source)
			binding := "trusted"
			if helper != binding {
				binding += " as " + helper
			}
			plan.declaration = append(plan.declaration, trustedImportEdit(source, "vibelang-runtime", binding))
		}
		var classes []string
		for _, f := range t.failures {
			classes = append(classes, f.name)
		}
		end := statement.End()
		plan.declaration = append(plan.declaration, trustedValueEdit{end, end, "\nexport const " + plan.name + " = " + helper + "(" + decl.Name().Text() + ", [" + strings.Join(classes, ", ") + "]);\n"})
	}
	local := ""
	for _, stmt := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(stmt) || stmt.ModuleSpecifier().Text() != imported.ModuleSpecifier().Text() {
			continue
		}
		local = namedImportLocal(stmt, plan.name)
		if local != "" {
			break
		}
	}
	if local == "" {
		local = fresh(plan.name, file)
		binding := plan.name
		if local != binding {
			binding += " as " + local
		}
		plan.caller = append(plan.caller, trustedImportEdit(file, imported.ModuleSpecifier().Text(), binding))
	}
	plan.caller = append(plan.caller, trustedValueEdit{nodeStart(file, callee), callee.End(), local})
	return plan
}

// namedImportLocal finds a value import's local spelling so fixes preserve aliases.
func namedImportLocal(statement *ast.Node, name string) string {
	clause := statement.ImportClause()
	if clause == nil || clause.AsImportClause().IsTypeOnly() {
		return ""
	}
	bindings := clause.AsImportClause().NamedBindings
	if bindings == nil || !ast.IsNamedImports(bindings) {
		return ""
	}
	for _, spec := range bindings.Elements() {
		if spec.AsImportSpecifier().IsTypeOnly {
			continue
		}
		original := spec.PropertyName()
		if original == nil {
			original = spec.Name()
		}
		if original.Text() == name {
			return spec.Name().Text()
		}
	}
	return ""
}

// trustedImportName finds the existing runtime import to avoid duplicate helpers.
func trustedImportName(file *ast.SourceFile, name string) string {
	for _, stmt := range file.Statements.Nodes {
		if ast.IsImportDeclaration(stmt) && stmt.ModuleSpecifier().Text() == "vibelang-runtime" {
			if local := namedImportLocal(stmt, name); local != "" {
				return local
			}
		}
	}
	return ""
}

// trustedImportEdit extends a named import or adds one while preserving comments.
func trustedImportEdit(file *ast.SourceFile, module, binding string) trustedValueEdit {
	pos := 0
	if strings.HasPrefix(file.Text(), "#!") {
		if e := strings.IndexByte(file.Text(), '\n'); e >= 0 {
			pos = e + 1
		}
	}
	for _, stmt := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(stmt) {
			continue
		}
		pos = stmt.End()
		if stmt.ModuleSpecifier().Text() != module {
			continue
		}
		clause := stmt.ImportClause()
		if clause == nil || clause.AsImportClause().IsTypeOnly() {
			continue
		}
		bindings := clause.AsImportClause().NamedBindings
		if bindings == nil || !ast.IsNamedImports(bindings) {
			continue
		}
		elements := bindings.Elements()
		at := bindings.End() - 1
		text := binding
		if len(elements) != 0 {
			at = elements[len(elements)-1].End()
			text = ", " + binding
		}
		return trustedValueEdit{at, at, text}
	}
	return trustedValueEdit{pos, pos, "\nimport { " + binding + " } from " + strconv.Quote(module) + ";\n"}
}

// EK9101 exposes unsafe data-method accesses as editor-only annotation fixes.
var EK9101 = message(9101, diagnostics.CategorySuggestion, "{0}")

// EK9100 asks for the annotation the text-only projector cannot infer. It is
// an editor warning before the emit switch; the CLI does not run this check.
var EK9100 = message(9100, legacyFormChoiceCategory, "{0}")

func init() {
	registry[EK9100.Code] = EK9100
	registry[EK9101.Code] = EK9101
	ls.RegisterCodeFixProvider(inferredReceiverFix)
	ls.RegisterFileDiagnosticsHook(formChoiceDiagnostics)
}

// formChoiceCache holds syntax-only results under weak source-file identities.
// A new file version gets a new AST; neither results nor cleanup retain it.
var formChoiceCache sync.Map // weak.Pointer[ast.SourceFile] -> func() []vibelangmapper.Diagnostic

// cachedFormChoices resolves only the requested file, once per immutable AST,
// and shares results across LS pulls and checker instances without retaining files.
func cachedFormChoices(file *ast.SourceFile) []vibelangmapper.Diagnostic {
	key := weak.Make(file)
	compute := sync.OnceValue(func() []vibelangmapper.Diagnostic {
		return vibelangmapper.FormDiagnostics(file)
	})
	cached, loaded := formChoiceCache.LoadOrStore(key, compute)
	if !loaded {
		runtime.AddCleanup(file, func(k weak.Pointer[ast.SourceFile]) { formChoiceCache.Delete(k) }, key)
	}
	return cached.(func() []vibelangmapper.Diagnostic)()
}

// formDiagnosticCache retains materialized editor diagnostics only while the
// owning program is alive; imported types and category settings can change
// across programs even when the open file's syntax has not changed.
var formDiagnosticCache sync.Map // weak.Pointer[compiler.Program] -> *sync.Map

// formChoiceDiagnostics shares one editor analysis per file and program across
// repeated pulls. Neither this cache nor the syntax cache retains a program.
func formChoiceDiagnostics(ctx context.Context, service *ls.LanguageService, file *ast.SourceFile) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return nil
	}
	program := service.GetProgram()
	key := weak.Make(program)
	cache, loaded := formDiagnosticCache.LoadOrStore(key, &sync.Map{})
	if !loaded {
		runtime.AddCleanup(program, func(k weak.Pointer[compiler.Program]) { formDiagnosticCache.Delete(k) }, key)
	}
	compute := sync.OnceValue(func() []*ast.Diagnostic {
		// A canceled checker request must not poison later pulls of this version.
		defer func() {
			if reason := recover(); reason != nil {
				cache.(*sync.Map).Delete(file)
				panic(reason)
			}
		}()
		result := resolveFormChoiceDiagnostics(ctx, service, file)
		if ctx.Err() != nil {
			cache.(*sync.Map).Delete(file)
		}
		return result
	})
	result, _ := cache.(*sync.Map).LoadOrStore(file, compute)
	return result.(func() []*ast.Diagnostic)()
}

// resolveFormChoiceDiagnostics materializes cached syntax choices on demand.
// The CLI never calls this provider or pays for the forms resolver.
func resolveFormChoiceDiagnostics(ctx context.Context, service *ls.LanguageService, file *ast.SourceFile) []*ast.Diagnostic {
	choices := cachedFormChoices(file)
	if len(choices) == 0 {
		return nil
	}
	c, done := service.GetProgram().GetTypeCheckerForFile(ctx, file)
	defer done()
	var result []*ast.Diagnostic
	for _, choice := range choices {
		if d := newDiagnosticAt(optionsFor(c, file), file, core.NewTextRange(choice.Start, choice.Start+choice.Length), formChoiceMessage(choice.Code), choice.Message); d != nil {
			result = append(result, d)
		}
	}
	return result
}

// isFormChoiceLambda mirrors the projector's source lambdas, excluding parser
// helpers and JavaScript async/generator functions whose forms are fixed.
func isFormChoiceLambda(n *ast.Node) bool {
	if n.Flags&ast.NodeFlagsReparsed != 0 || n.Body() == nil || ast.HasSyntacticModifier(n, ast.ModifierFlagsAsync) {
		return false
	}
	switch n.Kind {
	case ast.KindArrowFunction:
		token := n.AsArrowFunction().EqualsGreaterThanToken
		return token != nil && token.Flags&ast.NodeFlagsReparsed == 0
	case ast.KindFunctionExpression:
		return n.AsFunctionExpression().AsteriskToken == nil
	case ast.KindMethodDeclaration:
		return n.Parent != nil && ast.IsObjectLiteralExpression(n.Parent) && n.AsMethodDeclaration().AsteriskToken == nil
	}
	return false
}

// inferredFormFix freezes the fork's selected lowering and inferred channels
// in source, so answering a projector choice preserves existing execution.
var inferredFormFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{9100},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var fn *ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if (isFormChoiceLambda(n) || isFormChoiceBlock(n)) && nodeStart(fix.SourceFile, n) == fix.Span.Pos() && n.End() == fix.Span.End() {
				fn = n
				return true
			}
			return n.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if fn == nil {
			// Await expressions and held values have no written lambda to annotate.
			// Introducing one changes collection conversions in the fork.
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		a := analyzerFor(c)
		f := a.finalForm(fn)
		if f == formProgram {
			return nil, nil
		}
		if ast.IsMethodDeclaration(fn) {
			f = formPlain
			if a.isEffect(fn) {
				f = formEffect
			}
		}
		// A plain form whose body pauses is EK4301's conflict, not a choice:
		// a plain annotation there adds EK9203, so no annotation keeps the
		// program (Chapter 28, Rewrites keep meaning, D372).
		if (f == formPlain || f == formNone) && a.firstPause(fn) != nil {
			return nil, nil
		}
		printType := func(t *checker.Type) string {
			return c.TypeToStringEx(t, fn, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
		}
		annotation := printType(c.GetReturnTypeFromBody(fn))
		if f != formPlain && f != formNone {
			info := a.effectOf(fn)
			if info == nil {
				return nil, nil
			}
			annotation = bangTypes("Effect<" + annotation + ", " + printType(c.GetUnionType(info.errors)) + ", " + printType(c.GetUnionType(info.requirements)) + ">")
		}
		var changes []*lsproto.TextEdit
		if isFormChoiceBlock(fn) {
			call := fn.Parent
			start := nodeStart(fix.SourceFile, call)
			brace := nodeStart(fix.SourceFile, fn.Body())
			head := strings.TrimRight(fix.SourceFile.Text()[start:brace], " \t\r\n")
			if strings.HasSuffix(head, ")") {
				head = strings.TrimSuffix(head, ")")
				if len(call.Arguments()) > 1 {
					head += ", "
				}
			} else {
				head += "("
			}
			changes = replaceRange(fix, start, brace, head+"(): "+annotation+" => ")
			changes = append(changes, replaceRange(fix, fn.End(), fn.End(), ")")...)
		} else if fn.Type() != nil {
			changes = replaceRange(fix, nodeStart(fix.SourceFile, fn.Type()), fn.Type().End(), annotation)
		} else {
			at := nodeStart(fix.SourceFile, fn.Body())
			if ast.IsArrowFunction(fn) {
				at = nodeStart(fix.SourceFile, fn.AsArrowFunction().EqualsGreaterThanToken)
				params := fn.Parameters()
				if len(params) == 1 && fix.SourceFile.Text()[nodeStart(fix.SourceFile, fn):nodeStart(fix.SourceFile, params[0])] == "" {
					changes = append(changes, replaceRange(fix, nodeStart(fix.SourceFile, params[0]), nodeStart(fix.SourceFile, params[0]), "(")...)
					changes = append(changes, replaceRange(fix, params[0].End(), params[0].End(), ")")...)
				}
			}
			changes = append(changes, replaceRange(fix, at, at, ": "+annotation+" ")...)
		}
		return []*ls.CodeAction{{Description: "Annotate as the fork infers", Changes: changes}}, nil
	},
}

// isFormChoiceBlock recognizes the parser's block-parameter lambda so choices
// on bare blocks are surfaced and can be rewritten as annotated arguments.
func isFormChoiceBlock(n *ast.Node) bool {
	if n.Parent == nil || !isBlockParamCall(n.Parent) {
		return false
	}
	args := n.Parent.Arguments()
	return args[len(args)-1] == n
}

// formChoiceMessage preserves the editor category for each projector choice.
func formChoiceMessage(code int32) *Message {
	if code == vibelangmapper.CodeDataMethod {
		return EK9101
	}
	return EK9100
}

// inferredReceiverFix freezes the checker type on a local declaration or
// expression assertion, preserving shadows and leaving imported declarations alone.
var inferredReceiverFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{9101},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var access, receiver *ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsPropertyAccessExpression(n) && nodeStart(fix.SourceFile, n) == fix.Span.Pos() && n.End() == fix.Span.End() {
				access = n
				receiver = ast.SkipParentheses(n.Expression())
				for ast.IsPropertyAccessExpression(receiver) {
					receiver = ast.SkipParentheses(receiver.Expression())
				}
				return true
			}
			return n.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if receiver == nil {
			return nil, nil
		}
		// An automatic change keeps the program (Chapter 28, D372). super
		// takes no assertion, and `(this as T).x = …` hides a constructor's
		// assignment from definite assignment (TS2564).
		if receiver.Kind == ast.KindSuperKeyword || receiver.Kind == ast.KindThisKeyword && ast.IsAssignmentTarget(access) {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		if !ast.IsIdentifier(receiver) {
			annotation := c.TypeToStringEx(c.GetTypeAtLocation(receiver), receiver, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
			if annotation == "any" || annotation == "unknown" {
				return nil, nil
			}
			start := nodeStart(fix.SourceFile, receiver)
			changes := replaceRange(fix, start, start, "(")
			changes = append(changes, replaceRange(fix, receiver.End(), receiver.End(), " as "+annotation+")")...)
			return []*ls.CodeAction{{Description: "Annotate as the fork infers", Changes: changes}}, nil
		}
		symbol := c.GetSymbolAtLocation(receiver)
		if symbol == nil {
			return nil, nil
		}
		declaration := symbol.ValueDeclaration()
		if declaration == nil || !ast.IsVariableDeclaration(declaration) && !ast.IsParameterDeclaration(declaration) || declaration.Type() != nil || !ast.IsIdentifier(declaration.Name()) || ast.GetSourceFileOfNode(declaration) != fix.SourceFile {
			return nil, nil
		}
		// Only a declaration written as one takes an annotation: the binding
		// of a for-of or for-in loop (TS2483) and of a catch clause cannot,
		// and the parser synthesizes the initializer of a VibeLang form's
		// binding, such as `finally (exit)`, whose source has no place for one.
		if ast.IsVariableDeclaration(declaration) && (declaration.Parent != nil && ast.IsForInOrOfStatement(declaration.Parent.Parent) || ast.IsCatchClause(declaration.Parent) ||
			declaration.Initializer() != nil && declaration.Initializer().Flags&ast.NodeFlagsReparsed != 0) {
			return nil, nil
		}
		annotation := c.TypeToStringEx(c.GetTypeAtLocation(declaration.Name()), declaration, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
		if annotation == "any" || annotation == "unknown" {
			return nil, nil
		}
		at := declaration.Name().End()
		return []*ls.CodeAction{{Description: "Annotate as the fork infers", Changes: replaceRange(fix, at, at, ": "+annotation)}}, nil
	},
}
