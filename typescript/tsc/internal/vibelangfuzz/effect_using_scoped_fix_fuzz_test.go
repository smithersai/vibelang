package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const usingScopedFixTitle = "Acquire with acquireDisposable inside scoped"

// Each form states whether EK0801's fix is context-safe there.
var usingScopedForms = map[string]struct {
	source  string
	offered bool
}{
	"function":        {"export effect function load() { using r = open(); return 1 }", true},
	"arrow":           {"export const load = effect () => { using r = open(); return 1 }", true},
	"method":          {"export class Loader { effect load() { using r = open(); return 1 } }", true},
	"no-rest":         {"export effect function load() { using r = open() }", true},
	"two-values":      {"export effect function load() { using a = open(), b = open(); return 2 }", true},
	"before":          {"export effect function load() { const n = 1; using r = open(); return n }", true},
	"object-literal":  {"export effect function load() { using r = { [Symbol.dispose]() { } }; return 1 }", true},
	"multiline":       {"export effect function load() {\n  using r = open()\n  const n = 1\n  return n\n}", true},
	"producer":        {"export effect function* load() { using r = open(); yield 1 }", false},
	"nested-block":    {"export effect function load() { { using r = open() } return 1 }", false},
	"for-head":        {"export effect function load() { for (using r of [open()]) { } return 1 }", false},
	"null":            {"export effect function load() { using r = null; return 1 }", false},
	"effect-operand":  {"export effect function load() { using r = try Effect.succeed(open()); return 1 }", false},
	"shadowed-scoped": {"const scoped = 1\nexport effect function load() { using r = open(); return scoped }", false},
}

func TestEffectUsingScopedFixQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", effectUsingWarningQuote)
}

func FuzzEffectUsingScopedFix(f *testing.F) {
	startShortBudget(f)
	for key := range usingScopedForms {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		form, ok := usingScopedForms[key]
		if !ok {
			key, form = "function", usingScopedForms["function"]
		}
		source := "const open = (): Disposable => ({ [Symbol.dispose]() { } })\n" + form.source + "\n"
		if mode&1 != 0 {
			source = "// café 😀\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzEffectUsingScopedFix", files)
		defer result.Remove()
		editor := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: result, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(result.Dir, "main.vibe")}
		var err error
		editor.run("didOpen", func() {
			editor.session.DidOpenFile(editor.ctx, editor.uri, 1, source, toolsLanguage)
			editor.service, err = editor.session.GetLanguageService(editor.ctx, editor.uri)
		})
		defer func() {
			if sessions.current == editor.session {
				editor.run("didClose", func() { editor.session.DidCloseFile(editor.ctx, editor.uri) })
			}
		}()
		if err != nil {
			t.Fatal(err)
		}
		items, ok := toolsRequest(editor, "using diagnostics", func(service *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
			return toolsDiagnostics(t.Context(), service, editor.uri)
		})
		if !ok {
			t.Fatal("missing using diagnostics response")
		}
		gapKey := "using-scoped-fix:" + key
		var diagnostic *lsproto.Diagnostic
		for _, item := range items {
			if code, _ := toolsDiagnosticCode(item); code == 801 {
				diagnostic = item
				break
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzEffectUsingScopedFix", gapKey, "missing EK0801: %s", source)
			return
		}
		response, ok := toolsRequest(editor, "using scoped", func(service *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri}, Range: diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}}})
		})
		found := false
		if ok && response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				action := item.CodeAction
				if action == nil || action.Edit == nil || action.Title != usingScopedFixTitle {
					continue
				}
				found = true
				edited, _ := editor.apply(gapKey, action.Title, action.Edit)
				if edited == nil {
					Gap(t, "FuzzEffectUsingScopedFix", gapKey, "invalid scoped edit")
					continue
				}
				checked, err := w.Compile(t.Context(), Project{Files: edited})
				if err != nil {
					t.Fatal(err)
				}
				defer checked.Remove()
				if !toolsErrorFree(checked) || !strings.Contains(edited["main.vibe"], "try acquireDisposable(sync(() =>") {
					Gap(t, "FuzzEffectUsingScopedFix", gapKey, "%s must typecheck: %v\n%s", effectUsingWarningQuote, checked.Diagnostics, edited["main.vibe"])
				}
				for _, d := range checked.Diagnostics {
					if d.Code() == 801 {
						Gap(t, "FuzzEffectUsingScopedFix", gapKey, "the fix left a using: %v\n%s", d, edited["main.vibe"])
					}
				}
			}
		}
		if found != form.offered {
			Gap(t, "FuzzEffectUsingScopedFix", gapKey, "offered %v, want %v: %s", found, form.offered, source)
		}
	})
}
