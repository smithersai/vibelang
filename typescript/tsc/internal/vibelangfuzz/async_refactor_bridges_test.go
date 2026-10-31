package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// This is a source-rewrite oracle, not a second runtime differential runner.
const asyncRefactorBridgeQuote = "| a Promise, in an `effect` function | an Effect | `try tryPromise(() => queryDb(q))` or `try promise(() => p)` |"

func requireAsyncRefactorBridgeQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), asyncRefactorBridgeQuote) {
		t.Fatalf("chapter 001 no longer contains %q", asyncRefactorBridgeQuote)
	}
}

func TestAsyncRefactorBridgesQuoted(t *testing.T) { requireAsyncRefactorBridgeQuote(t) }

// Keys pin the declaration, method and block-arrow neighborhoods. The fuzz
// bytes vary Promise operands, grouping, comments, Unicode offsets and values.
func FuzzAsyncRefactorBridges(f *testing.F) {
	startShortBudget(f)
	requireAsyncRefactorBridgeQuote(f)
	for _, key := range []string{"declaration", "method", "block-arrow"} {
		f.Add(key, uint8(0), uint8(1))
		f.Add(key, uint8(3), uint8(7))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode, value uint8) {
		if key != "method" && key != "block-arrow" {
			key = "declaration"
		}
		operand := []string{"input", "(input)", "Promise.resolve(input)", "(Promise.resolve(input))"}[mode%4]
		body := fmt.Sprintf("{ const value = await %s; return value + %d }", operand, value)
		source := "export async function load(input: Promise<number>) " + body
		switch key {
		case "method":
			source = "export class Loader { async load(input: Promise<number>) " + body + " }"
		case "block-arrow":
			source = "export const load = async (input: Promise<number>) => " + body
		}
		if mode&4 != 0 {
			source = "const café = '😀';\n" + source
		}
		if mode&8 != 0 {
			source = strings.Replace(source, "await ", "await /* promise */ ", 1)
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzAsyncRefactorBridges", files)
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
		position := newToolsLines(source).position(strings.Index(source, "async"))
		response, ok := toolsRequest(e, "async refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        lsproto.Range{Start: position, End: position},
				Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}},
			})
		})
		if !ok || response.CommandOrCodeActionArray == nil {
			t.Fatal("no async refactor response")
		}
		found := 0
		for _, item := range *response.CommandOrCodeActionArray {
			action := item.CodeAction
			if action == nil || !strings.HasPrefix(action.Title, "Convert to a VibeLang function") {
				continue
			}
			found++
			edited, _ := e.apply("async-refactor:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("async refactor did not edit its document")
			}
			got := edited["main.vibe"]
			want := "try Effect.tryPromise(() => " + operand + ")"
			if strings.HasSuffix(action.Title, "with an error per await") {
				want = "try Effect.tryPromise({ try: () => " + operand + ", catch: (cause) => new "
			}
			if !strings.Contains(got, want) || strings.Contains(got, "await ") {
				Gap(t, "FuzzAsyncRefactorBridges", "async-refactor:bridge:"+key, "%s; want %q after %s\n%s", asyncRefactorBridgeQuote, want, action.Title, Archive(edited))
			}
		}
		if found != 2 {
			Gap(t, "FuzzAsyncRefactorBridges", "async-refactor:actions:"+key, "expected both Promise bridge refactors, got %d\n%s", found, e.archive)
		}
	})
}
