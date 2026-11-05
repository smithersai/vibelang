package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const legacyRepairQuote = "Such code lives in a `.ts` file or a `module` body"

func requireLegacyRepairQuote(t testing.TB) {
	t.Helper()
	data, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), legacyRepairQuote) {
		t.Fatalf("missing legacy repair rule: %q", legacyRepairQuote)
	}
}
func TestLegacyJavaScriptRepairQuoted(t *testing.T) { requireLegacyRepairQuote(t) }

// Static editor oracle: the repair preserves every byte of a closed native
// scope inside the VIP-40 module, and refuses dependencies or VibeLang syntax.
func FuzzLegacyJavaScriptRepair(f *testing.F) {
	startShortBudget(f)
	requireLegacyRepairQuote(f)
	for _, key := range []string{"var", "eval", "indirect-eval", "Function", "arguments", "default-alias", "effect-refusal", "import-refusal", "meta-refusal"} {
		for _, mode := range []uint8{0, 1, 2} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		gap := []string{" ", " /* declaration */ ", "\t"}[mode%3]
		source := "export function f() { var" + gap + "n = 1; return n }"
		want := true
		switch key {
		case "eval":
			source = "export function f() { return eval('1') }"
		case "indirect-eval":
			source = "export function f() { return (0, eval)('1') }"
		case "Function":
			source = "export const f = Function('return 1')"
		case "arguments":
			source = "export function f() { return arguments.length }"
		case "default-alias":
			source = "var n = 1; export { n as default }; export function f() { return n }"
		case "effect-refusal":
			source = "export effect function f() { var n = 1; return n }"
			want = false
		case "import-refusal":
			source = "import { Effect } from 'effect'; export const f = Function"
			want = false
		case "meta-refusal":
			source = "export const url = import.meta.url; var n = 1; export { n }"
			want = false
		default:
			key = "var"
		}
		if mode == 2 {
			source = "// café 😀\n" + source
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzLegacyJavaScriptRepair", files)
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
		items, ok := toolsRequest(e, "var diagnostics", func(s *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
			return toolsDiagnostics(t.Context(), s, e.uri)
		})
		if !ok {
			t.Fatal("no legacy diagnostics")
		}
		var diagnostic *lsproto.Diagnostic
		for _, d := range items {
			if d.Message.String != nil && strings.Contains(*d.Message.String, "is not allowed in a .vibe file") || d.Message.String != nil && strings.Contains(*d.Message.String, "Function reaches") {
				diagnostic = d
				break
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzLegacyJavaScriptRepair", "legacy-repair:diagnostic:"+key, "%s; no legacy diagnostic\n%s", legacyRepairQuote, source)
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

		found := false
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				a := item.CodeAction
				if a == nil || a.Title != "Write a TypeScript module for legacy JavaScript" {
					continue
				}
				found = true
				edits, ok := toolsWorkspaceEdits(a.Edit)
				if !ok {
					t.Fatal("missing repair edit")
				}
				text, _, err := toolsApply(source, edits[e.uri])
				if err != nil {
					t.Fatal(err)
				}
				if key == "default-alias" && !strings.Contains(text, "export { default } from ") {
					Gap(t, "FuzzLegacyJavaScriptRepair", "legacy-repair:default", "%s; default export lost", legacyRepairQuote)
				}
				if !strings.Contains(text, "\n"+source+"\n}") || !strings.Contains(text, "export * from ") {
					Gap(t, "FuzzLegacyJavaScriptRepair", "legacy-repair:scope:"+key, "%s; source scope changed\n%s", legacyRepairQuote, text)
				}
				result, err := w.Compile(t.Context(), Single(text))
				if err != nil {
					t.Fatal(err)
				}
				defer result.Remove()
				for _, d := range result.Diagnostics {
					if d.Category() == diagnostics.CategoryError {
						Gap(t, "FuzzLegacyJavaScriptRepair", "legacy-repair:compile:"+key, "%s; repair diagnostics %v", legacyRepairQuote, result.Diagnostics)
						break
					}
				}
			}
		}
		if found != want {
			Gap(t, "FuzzLegacyJavaScriptRepair", "legacy-repair:action:"+key, "%s; actionable repair %v, want %v\n%s", legacyRepairQuote, found, want, source)
		}
	})
}
