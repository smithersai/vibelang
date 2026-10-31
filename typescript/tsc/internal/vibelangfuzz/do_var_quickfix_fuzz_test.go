package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// The native do lowering preserves function-scoped var. A global source
// restriction must not offer an automatic edit that changes that scope.
func FuzzDoVarQuickFix(f *testing.F) {
	startShortBudget(f)
	requireVarDenialQuotes(f)
	for _, key := range []string{"direct", "typed", "multiple", "global", "nested", "loop"} {
		for _, mode := range []uint8{0, 1, 4} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		gap := []string{" ", "/* declaration */", "\t"}[mode%3]
		declaration, value := "var"+gap+"value = 1", "value"
		switch key {
		case "direct":
		case "typed":
			declaration = "var" + gap + "value: number = 1"
		case "multiple":
			declaration, value = "var"+gap+"first = 1, second = 2", "first + second"
		case "global", "nested", "loop":
		default:
			key = "direct"
		}
		source := "export function load(): number { return do { " + declaration + "; " + value + " } }"
		switch key {
		case "global":
			source = "export function load(): number { " + declaration + "; return value }"
		case "nested":
			source = "export function load(): number { return do { { " + declaration + " }; value } }"
		case "loop":
			source = "export function load(): number { return do { for (var" + gap + "value = 0; value < 2; value++) {}; value } }"
		}
		if mode&4 != 0 {
			source = "// café 😀\n" + source
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzDoVarQuickFix", files)
		defer r.Remove()
		e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: r, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(r.Dir, "main.vibe")}
		var err error
		e.run("didOpen", func() {
			e.session.DidOpenFile(e.ctx, e.uri, 1, source, toolsLanguage)
			e.service, err = e.session.GetLanguageService(e.ctx, e.uri)
		})
		defer func() {
			if sessions.current == e.session {
				e.run("didClose", func() { e.session.DidCloseFile(e.ctx, e.uri) })
			}
		}()
		if err != nil {
			t.Fatal(err)
		}
		diagnostics, ok := toolsRequest(e, "var diagnostics", func(s *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
			return toolsDiagnostics(t.Context(), s, e.uri)
		})
		if !ok {
			t.Fatal("no var diagnostics")
		}
		var diagnostic *lsproto.Diagnostic
		for _, d := range diagnostics {
			if d.Message.String != nil && strings.Contains(*d.Message.String, "var is not allowed in a .vibe file.") {
				diagnostic = d
				break
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzDoVarQuickFix", "do-var:diagnostic:"+key, "%s; no var diagnostic\n%s", varDenialQuote, source)
			return
		}
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, ok := toolsRequest(e, "var quick fix", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
			})
		})
		if !ok {
			t.Fatal("no var quick-fix response")
		}
		found := 0
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				action := item.CodeAction
				if action == nil || action.Title != "Replace var with let" {
					continue
				}
				found++
				Gap(t, "FuzzDoVarQuickFix", "do-var:unsafe:"+key, "%s; repair would change declaration scope\n%s", varDenialQuote, source)
			}
		}
		expected := 0
		if found != expected {
			Gap(t, "FuzzDoVarQuickFix", "do-var:actions:"+key, "%s; got %d local repairs, want %d\n%s", varDenialQuote, found, expected, source)
		}
	})
}
