package vibelangfuzz

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// FuzzEditor opens a project's main .vibe file in the language server
// (Chapter 28, "The editor": the server is the compiler's own, D32) and, at
// fuzz-chosen offsets, requests what an editor requests: hover, completions
// and their details, definition, type definition, references, rename,
// signature help, document highlights and code actions; and for the whole
// document diagnostics, document symbols, folding ranges, inlay hints,
// semantic tokens, and the code actions of every diagnostic. It checks:
//
//   - No request panics or hangs.
//   - Every range and position a response returns lies inside its document,
//     as LSP 3.17 defines one; diagnostics print at .vibe spans (D61).
//   - Every code action and rename edits inside its documents without
//     overlapping, and leaves a file that parsed still parsing: "Every
//     automatic change to source keeps the program's meaning" (Chapter 28,
//     "Rewrites keep meaning", D372).
//   - Applying an EK diagnostic's quick fix removes that diagnostic at its
//     span and adds no error: a quick fix keeps the program's meaning, and
//     "that the rewritten program reports no new error is checked as well"
//     (D372, D291).
//
// offsets holds big-endian pairs of bytes, each a byte offset into the main
// file modulo its length.
func FuzzEditor(f *testing.F) {
	startShortBudget(f)
	seeds := append(toolsSample(CaseSeeds(), 22, 400, func(s Seed) bool { return strings.HasPrefix(s.Name, "tsforms-") }), toolsSample(SnippetSeeds(), 16, 300, nil)...)
	for _, seed := range seeds {
		main := toolsMainFile(seed.Files)
		if main == "" {
			continue
		}
		f.Add(Archive(seed.Files), toolsInterestingOffsets(seed.Files[main]))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, archive string, offsets []byte) {
		toolsGuard(t, "FuzzEditor", func() {
			files := toolsUnarchive(archive)
			for name, text := range files {
				files[name] = strings.ToValidUTF8(text, "?") // an LSP document is UTF-8
			}
			main := toolsMainFile(files)
			if main == "" || toolsTooLarge(files) || toolsLeftOut("FuzzEditor", files) {
				return
			}
			r := toolsCompile(t, w, "FuzzEditor", files)
			defer r.Remove()
			if r.SourceFile(main) == nil {
				return // a tsconfig that leaves the file out of its program
			}
			e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: r, files: files, archive: archive, main: main, uri: toolsURI(r.Dir, main)}
			e.requests(offsets)
		})
	})
}

// toolsInterestingOffsets seeds the offsets of a file at its VibeLang
// keywords and operators, and at a few evenly spaced places.
func toolsInterestingOffsets(text string) []byte {
	var offsets []byte
	add := func(n int) { offsets = append(offsets, byte(n>>8), byte(n)) }
	for _, m := range toolsInterestingToken.FindAllStringIndex(text, 6) {
		add(m[0])
	}
	for i := 1; i <= 3; i++ {
		add(len(text) * i / 4)
	}
	return offsets
}

var toolsInterestingToken = regexp.MustCompile(`\b(catch|provide|fork|join|match|when|error|service|throw|wire|sync|using|schema|data|control)\b|\|>|!|%`)

// A toolsEditor holds one FuzzEditor input.
type toolsEditor struct {
	t        *testing.T
	ctx      context.Context
	sessions *toolsSessions
	session  *toolsSession
	w        *Workspace
	r        *Result
	files    map[string]string
	archive  string
	main     string
	uri      lsproto.DocumentUri
	service  *ls.LanguageService
	verified int
	where    string // the request's position, for a report
}

func (e *toolsEditor) requests(offsets []byte) {
	var err error
	e.run("didOpen", func() {
		e.session.DidOpenFile(e.ctx, e.uri, 1, e.files[e.main], toolsLanguage)
		e.service, err = e.session.GetLanguageService(e.ctx, e.uri)
	})
	defer func() {
		if e.sessions.current == e.session { // a poisoned session may hold its locks
			e.run("didClose", func() { e.session.DidCloseFile(e.ctx, e.uri) })
		}
	}()
	if err != nil {
		e.t.Fatalf("no language service for %s: %v", e.uri, err)
	}
	text := e.files[e.main]
	lines := newToolsLines(text)
	document := lsproto.TextDocumentIdentifier{Uri: e.uri}
	whole := lsproto.Range{End: lines.position(len(text))}

	var diagnostics []*lsproto.Diagnostic
	e.run("diagnostics", func() { diagnostics, err = toolsDiagnostics(e.ctx, e.service, e.uri) })
	if err != nil {
		Gap(e.t, "FuzzEditor", "editor:request:diagnostics", "LSP 3.17/D61: diagnostics request failed: %v\n%s", err, e.archive)
	}
	e.check("diagnostics", diagnostics)
	toolsRequest(e, "document symbols", func(s *ls.LanguageService) (lsproto.DocumentSymbolResponse, error) {
		return s.ProvideDocumentSymbols(e.ctx, e.uri)
	})
	toolsRequest(e, "folding ranges", func(s *ls.LanguageService) (lsproto.FoldingRangeResponse, error) {
		return s.ProvideFoldingRange(e.ctx, e.uri)
	})
	toolsRequest(e, "inlay hints", func(s *ls.LanguageService) (lsproto.InlayHintResponse, error) {
		return s.ProvideInlayHint(e.ctx, &lsproto.InlayHintParams{TextDocument: document, Range: whole})
	})
	if tokens, ok := toolsRequest(e, "semantic tokens", func(s *ls.LanguageService) (lsproto.SemanticTokensResponse, error) {
		return s.ProvideSemanticTokens(e.ctx, e.uri)
	}); ok && tokens.SemanticTokens != nil {
		if bad := toolsBadSemanticTokens(tokens.SemanticTokens.Data, lines); len(bad) > 0 {
			Gap(e.t, "FuzzEditor", "editor:range", "semantic tokens: %s\n%s", strings.Join(bad, "\n"), e.archive)
		}
	}

	// Chapter 28, The editor: probe resolved references to declarations in
	// this program even when fuzz offsets land only on whitespace.
	declared := e.declaredReferences()
	positions := slices.Clone(declared[:min(2, len(declared))])
	for i := 0; i+1 < len(offsets) && i < 24; i += 2 {
		positions = append(positions, toolsRuneStart(text, (int(offsets[i])<<8|int(offsets[i+1]))%(len(text)+1)))
	}
	for _, offset := range positions {
		requireAnswer := slices.Contains(declared, offset) && toolsSyntaxError(e.main, text) == ""
		position := lines.position(offset)
		e.where = fmt.Sprintf("%d:%d (byte %d)", position.Line, position.Character, offset)
		if hover, ok := toolsRequest(e, "hover", func(s *ls.LanguageService) (lsproto.HoverResponse, error) {
			return s.ProvideHover(e.ctx, &lsproto.HoverParams{TextDocument: document, Position: position})
		}); ok && requireAnswer && !toolsHasHover(hover) {
			Gap(e.t, "FuzzEditor", "editor:empty:hover:"+toolsEnclosingKind(e.main, text, offset), "Chapter 28, The editor: hover is empty at declared identifier %s\n%s", e.where, e.archive)
		}
		if completion, ok := toolsRequest(e, "completion", func(s *ls.LanguageService) (lsproto.CompletionResponse, error) {
			return s.ProvideCompletion(e.ctx, e.uri, position, &lsproto.CompletionContext{TriggerKind: lsproto.CompletionTriggerKindInvoked})
		}); ok {
			var items []*lsproto.CompletionItem
			if completion.List != nil {
				items = completion.List.Items
			} else if completion.Items != nil {
				items = *completion.Items
			}
			if requireAnswer && len(items) == 0 {
				Gap(e.t, "FuzzEditor", "editor:empty:completion", "Chapter 28, The editor: completion is empty at declared identifier %s\n%s", e.where, e.archive)
			}
			for j, item := range items {
				if j >= 4 {
					break
				}
				if item.Data == nil {
					continue
				}
				toolsRequest(e, "completion item details", func(s *ls.LanguageService) (*lsproto.CompletionItem, error) {
					return s.ResolveCompletionItem(e.ctx, item, item.Data, e.uri.FileName())
				})
			}
		}
		if definition, ok := toolsRequest(e, "definition", func(s *ls.LanguageService) (lsproto.DefinitionResponse, error) {
			return s.ProvideDefinition(e.ctx, e.uri, position)
		}); ok && requireAnswer && !toolsHasDefinition(definition) {
			Gap(e.t, "FuzzEditor", "editor:empty:definition", "Chapter 28, The editor: definition is empty at declared identifier %s\n%s", e.where, e.archive)
		}
		toolsRequest(e, "type definition", func(s *ls.LanguageService) (lsproto.TypeDefinitionResponse, error) {
			return s.ProvideTypeDefinition(e.ctx, e.uri, position)
		})
		toolsRequest(e, "references", func(s *ls.LanguageService) (lsproto.ReferencesResponse, error) {
			return s.ProvideReferences(e.ctx, &lsproto.ReferenceParams{TextDocument: document, Position: position, Context: &lsproto.ReferenceContext{IncludeDeclaration: true}}, nil)
		})
		toolsRequest(e, "signature help", func(s *ls.LanguageService) (lsproto.SignatureHelpResponse, error) {
			return s.ProvideSignatureHelp(e.ctx, e.uri, position, nil)
		})
		toolsRequest(e, "document highlights", func(s *ls.LanguageService) (lsproto.DocumentHighlightResponse, error) {
			return s.ProvideDocumentHighlights(e.ctx, e.uri, position)
		})
		if rename, ok := toolsRequest(e, "rename", func(s *ls.LanguageService) (lsproto.RenameResponse, error) {
			return s.ProvideRename(e.ctx, &lsproto.RenameParams{TextDocument: document, Position: position, NewName: "renamedByFuzz"}, nil)
		}); ok && rename.WorkspaceEdit != nil {
			e.apply("rename", fmt.Sprintf("rename at %d:%d", position.Line, position.Character), rename.WorkspaceEdit)
		}
		// The refactors offered at the cursor, with no diagnostic.
		e.codeActions(lsproto.Range{Start: position, End: position}, nil)
	}
	for i, d := range diagnostics {
		if i >= 12 {
			break
		}
		e.where = fmt.Sprintf("the code actions of %s", toolsDiagnosticKey(d))
		e.codeActions(d.Range, d)
	}
}

// declaredReferences finds reference positions whose resolved declaration is
// in this project. A declaration's own name is a new-name completion context,
// so probe its uses, where Chapter 28 promises in-scope editor answers.
func (e *toolsEditor) declaredReferences() []int {
	checker, done := e.r.Program.GetTypeChecker(e.ctx)
	defer done()
	var positions []int
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindIdentifier && node.Parent != nil && node.Parent.Name() != node {
			if symbol := checker.GetSymbolAtLocation(node); symbol != nil {
				// An unresolved import alias is not a declaration in this program.
				symbol = checker.SkipAlias(symbol)
				if symbol == nil {
					return false
				}
				for _, declaration := range symbol.Declarations() {
					file := ast.GetSourceFileOfNode(declaration)
					if file == nil {
						continue
					}
					rel := strings.TrimPrefix(file.FileName().AsString(), filepath.ToSlash(e.r.Dir)+"/")
					if _, own := e.files[rel]; own {
						start := node.End() - len(node.Text())
						if start >= 0 && e.files[e.main][start:node.End()] == node.Text() {
							positions = append(positions, start)
						}
						break
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	e.r.SourceFile(e.main).AsNode().ForEachChild(visit)
	return positions
}

// LSP 3.17 allows null responses in general; Chapter 28's declared-identifier
// probes need actual contents or locations, rather than a vacuous range check.
func toolsHasHover(response lsproto.HoverResponse) bool {
	if response.Hover == nil {
		return false
	}
	contents := response.Hover.Contents
	if contents.MarkupContent != nil {
		return strings.TrimSpace(contents.MarkupContent.Value) != ""
	}
	if contents.String != nil {
		return strings.TrimSpace(*contents.String) != ""
	}
	if contents.MarkedStringWithLanguage != nil {
		return strings.TrimSpace(contents.MarkedStringWithLanguage.Value) != ""
	}
	return contents.MarkedStrings != nil && len(*contents.MarkedStrings) > 0
}

func toolsHasDefinition(response lsproto.DefinitionResponse) bool {
	return response.Location != nil || (response.Locations != nil && len(*response.Locations) > 0) ||
		(response.DefinitionLinks != nil && len(*response.DefinitionLinks) > 0)
}

// toolsRequest runs one request within the hang limit and checks the ranges of
// its response. A request that needs the auto-import registry runs again on
// a service that has it, as the LSP server retries it.
func toolsRequest[T any](e *toolsEditor, what string, fn func(*ls.LanguageService) (T, error)) (T, bool) {
	var response T
	var err error
	e.run(what, func() { response, err = fn(e.service) })
	if errors.Is(err, ls.ErrNeedsAutoImports) {
		e.run(what, func() {
			var service *ls.LanguageService
			if service, err = e.session.GetCurrentLanguageServiceWithAutoImports(e.ctx, e.uri); err == nil {
				response, err = fn(service)
			}
		})
	}
	if err != nil {
		// LSP 3.17 and D61: a parsed document must support its requests.
		if toolsSyntaxError(e.main, e.files[e.main]) == "" {
			Gap(e.t, "FuzzEditor", "editor:request:"+strings.ReplaceAll(what, " ", "-"), "%s failed at %s: %v\n%s", what, e.where, err, e.archive)
		}
		return response, false
	}
	e.check(what, response)
	return response, true
}

// run runs one stage of the input as toolsRun does. A panic poisons the
// session, since it may hold the session's locks.
func (e *toolsEditor) run(stage string, fn func()) {
	e.t.Helper()
	toolsRun(e.t, "FuzzEditor", stage, e.archive+"\nat "+e.where, e.sessions.poison, fn)
}

// check reports each range of a response that lies outside its document.
func (e *toolsEditor) check(what string, response any) {
	read := func(uri lsproto.DocumentUri) (string, bool) { return e.service.ReadFile(uri.FileName()) }
	if bad := toolsBadRanges(response, e.uri, read); len(bad) > 0 {
		Gap(e.t, "FuzzEditor", "editor:range", "%s: %s\n%s", what, strings.Join(bad, "\n"), e.archive)
	}
}

// codeActions requests the code actions of a range, applies each, and
// verifies the first EK quick fixes by compiling the result.
func (e *toolsEditor) codeActions(r lsproto.Range, d *lsproto.Diagnostic) {
	actionContext := &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}}
	if d != nil {
		actionContext.Diagnostics = []*lsproto.Diagnostic{d}
	}
	response, ok := toolsRequest(e, "code actions", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
		return s.ProvideCodeActions(e.ctx, &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri}, Range: r, Context: actionContext})
	})
	if !ok || response.CommandOrCodeActionArray == nil {
		return
	}
	for _, action := range *response.CommandOrCodeActionArray {
		if action.CodeAction == nil || action.CodeAction.Edit == nil {
			continue
		}
		files, edits := e.apply(toolsActionKey(action.CodeAction, d), "code action "+action.CodeAction.Title, action.CodeAction.Edit)
		if files == nil || d == nil || action.CodeAction.Kind == nil || *action.CodeAction.Kind != lsproto.CodeActionKindQuickFix {
			continue
		}
		if code, source := toolsDiagnosticCode(d); source == "EK" && e.verified < 3 {
			e.verified++
			e.verifyQuickFix(action.CodeAction.Title, code, d, files, edits)
		}
	}
}

// apply applies a workspace edit to the project's files. It reports edits
// outside their documents or overlapping, and a file that parsed and no
// longer parses. It returns the edited files and the main file's edits, or
// nil when the edit touches a file outside the project.
func (e *toolsEditor) apply(key, what string, edit *lsproto.WorkspaceEdit) (map[string]string, []toolsEdit) {
	changes, ok := toolsWorkspaceEdits(edit)
	if !ok {
		return nil, nil
	}
	files := maps.Clone(e.files)
	var mainEdits []toolsEdit
	prefix := filepath.ToSlash(e.r.Dir) + "/"
	for uri, edits := range changes {
		name := strings.TrimPrefix(uri.FileName().AsString(), prefix)
		before, ok := e.files[name]
		if !ok {
			return nil, nil
		}
		after, spans, err := toolsApply(before, edits)
		if err != nil {
			Gap(e.t, "FuzzEditor", "editor:edits:"+key, "%s on %s: %v\n%s", what, name, err, e.archive)
			return nil, nil
		}
		if !utf8.ValidString(after) {
			Gap(e.t, "FuzzEditor", "editor:edits:"+key, "%s splits a character of %s:\n%s", what, name, e.archive)
		}
		// D372: an automatic change keeps the program, so a file that
		// parsed still parses.
		if toolsSyntaxError(name, before) == "" {
			if syntax := toolsSyntaxError(name, after); syntax != "" {
				Gap(e.t, "FuzzEditor", "editor:parse:"+key, "%s leaves %s with a syntax error (%s):\n%s\nedited:\n%s", what, name, syntax, e.archive, after)
			}
		}
		files[name] = after
		if name == e.main {
			mainEdits = spans
		}
	}
	return files, mainEdits
}

// verifyQuickFix compiles the project with an EK diagnostic's quick fix
// applied. The diagnostic is gone from its span, and no error is added
// (D372, D291).
func (e *toolsEditor) verifyQuickFix(title string, code int32, d *lsproto.Diagnostic, files map[string]string, edits []toolsEdit) {
	start, end, ok := newToolsLines(e.files[e.main]).span(d.Range)
	if !ok {
		return // reported by check
	}
	start, end = toolsMap(start, edits, true), toolsMap(end, edits, false)
	fixed := toolsCompile(e.t, e.w, "FuzzEditor", files)
	defer fixed.Remove()
	if added := toolsAddedErrors(e.r, fixed); len(added) > 0 {
		// The key names the codes the fix adds, such as
		// editor:quickfix-error:EK4834:EK2116, so that one known gap of a
		// fix does not switch the oracle off for every error it may add.
		var codes []string
		for _, line := range added {
			if _, code, ok := strings.Cut(line, ": "); ok && !strings.HasPrefix(line, " ") && !slices.Contains(codes, code) {
				codes = append(codes, code)
			}
		}
		slices.Sort(codes)
		Gap(e.t, "FuzzEditor", fmt.Sprintf("editor:quickfix-error:EK%d:%s", code, strings.Join(codes, "+")), "the quick fix %q of EK%d adds errors: %s\n%s\nfixed:\n%s", title, code, strings.Join(added, "\n"), e.archive, Archive(files))
	}
	file := fixed.SourceFile(e.main)
	for _, after := range fixed.Diagnostics {
		if after.File() == file && file != nil && after.Source() == "EK" && after.Code() == code && after.Pos() == start && after.End() == end {
			Gap(e.t, "FuzzEditor", fmt.Sprintf("editor:quickfix-kept:EK%d", code), "the quick fix %q leaves EK%d at its span: %s\n%s\nfixed:\n%s", title, code, after.String(), e.archive, Archive(files))
		}
	}
}

// toolsActionKey names a code action in a pending key: a quick fix by the
// code of its diagnostic, such as "EK4832", and any other action by the
// first two words of its title, such as "Convert-to".
func toolsActionKey(action *lsproto.CodeAction, d *lsproto.Diagnostic) string {
	if d != nil && action.Kind != nil && *action.Kind == lsproto.CodeActionKindQuickFix {
		code, source := toolsDiagnosticCode(d)
		if source == "" {
			source = "TS"
		}
		return fmt.Sprintf("%s%d", source, code)
	}
	// A refactor is keyed by the words of its title, without the quoted
	// names the input supplies, so each refactor's gap is its own.
	var words []string
	for _, word := range strings.Fields(action.Title) {
		if !strings.ContainsAny(word, "'\"`") && len(words) < 5 {
			words = append(words, word)
		}
	}
	return strings.Join(words, "-")
}

// toolsEnclosingKind names the first three constructs around offset that are
// not expressions, innermost first, such as "ExpressionStatement<Block<
// FunctionDeclaration", so that a gap's key says where it happens rather
// than switching its oracle off everywhere.
func toolsEnclosingKind(name, text string, offset int) string {
	var kinds []string
	for node := astnav.GetTokenAtPosition(toolsParse(name, text), offset); node != nil && len(kinds) < 3; node = node.Parent {
		if node.Kind != ast.KindIdentifier && !ast.IsExpression(node) && node.Kind != ast.KindSourceFile {
			kinds = append(kinds, strings.TrimPrefix(node.Kind.String(), "Kind"))
		}
	}
	if len(kinds) == 0 {
		return "none"
	}
	return strings.Join(kinds, "<")
}
