package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const effectEscapeQuote = "`effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1)"

func TestEffectKeywordEscapesQuoted(t *testing.T) { requireEffectEscapeQuote(t) }
func requireEffectEscapeQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectEscapeQuote) {
		t.Fatalf("chapter 001 no longer contains %q", effectEscapeQuote)
	}
}

// Contextual effect keywords follow async's native TS1260 rule. Ordinary
// escaped identifiers stay legal; vary the escaped letter, spelling and form.
func FuzzEffectKeywordEscapes(f *testing.F) {
	startShortBudget(f)
	requireEffectEscapeQuote(f)
	for _, key := range []string{"function", "arrow", "class-method", "object-method", "block", "identifier", "property"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(11))
	}
	f.Add("function", uint8(16))
	f.Add("class-method", uint8(27))
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		index := int(mode % 6)
		word := "effect"
		escape := fmt.Sprintf("\\u%04x", word[index])
		if mode&8 != 0 {
			escape = fmt.Sprintf("\\u{%x}", word[index])
		}
		word = word[:index] + escape + word[index+1:]
		form := "WORD function load() { return 1 }"
		want := 1
		switch key {
		case "arrow":
			form = "const load = WORD () => 1"
		case "class-method":
			form = "class C { WORD load() { return 1 } }"
		case "object-method":
			form = "const c = { WORD load() { return 1 } }"
		case "block":
			form = "const load = WORD { return 1 }"
		case "identifier":
			form = "const WORD = 1"
			want = 0
		case "property":
			form = "class C { WORD() { return 1 } }"
			want = 0
		}
		source := strings.Replace(form, "WORD", word, 1)
		if mode&16 != 0 {
			source = "const café = '😀';\n" + source
		}
		items := toolsParse("main.vibe", source).Diagnostics()
		if len(items) != want || (want == 1 && items[0].Code() != 1260) {
			Gap(t, "FuzzEffectKeywordEscapes", "effect-keyword-escape:"+key, "%s; got %v, want %d TS1260\n%s", effectEscapeQuote, items, want, source)
			return
		}
		if want == 1 {
			span := items[0]
			wantSource := source[:span.Pos()] + "effect" + source[span.End():]
			checkEscapedEffectRepair(t, w, sessions, source, wantSource)
		}
	})
}

// The public editor action must repair only the diagnosed keyword, including
// real UTF-16 coordinates, and leave ordinary escaped identifiers untouched.
func checkEscapedEffectRepair(t *testing.T, w *Workspace, sessions *toolsSessions, source, want string) {
	files := map[string]string{"main.vibe": source}
	result := toolsCompile(t, w, "FuzzEffectKeywordEscapes", files)
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
	items, err := toolsDiagnostics(t.Context(), editor.service, editor.uri)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		code, _ := toolsDiagnosticCode(item)
		if code != 1260 {
			continue
		}
		response, ok := toolsRequest(editor, "escaped keyword repair", func(service *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri}, Range: item.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{item}}})
		})
		if !ok || response.CommandOrCodeActionArray == nil {
			continue
		}
		for _, candidate := range *response.CommandOrCodeActionArray {
			action := candidate.CodeAction
			if action == nil || action.Title != "Write the effect keyword without escapes" {
				continue
			}
			fixed, _ := editor.apply("effect-keyword:repair", action.Title, action.Edit)
			if fixed == nil || fixed["main.vibe"] != want {
				Gap(t, "FuzzEffectKeywordEscapes", "effect-keyword:repair", "keyword repair changed other source; want:\n%s\ngot:\n%s", want, Archive(fixed))
			}
			return
		}
	}
	Gap(t, "FuzzEffectKeywordEscapes", "effect-keyword:missing-repair", "TS1260 has no preserving keyword repair\n%s", source)
}
