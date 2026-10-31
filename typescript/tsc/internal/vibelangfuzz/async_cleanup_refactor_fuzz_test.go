package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const asyncCleanupQuote = "A rejected " + "`await`" + " resumes the " + "`async`" + " function with a throw. A failed " + "`try`" + " never resumes the generator."

func requireAsyncCleanupQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("008-runtime.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), asyncCleanupQuote) {
		t.Fatalf("missing async cleanup rule: %q", asyncCleanupQuote)
	}
}

func TestAsyncCleanupRefactorQuoted(t *testing.T) { requireAsyncCleanupQuote(t) }

// This is a source-rewrite safety oracle, not another runtime differential
// runner: the action must decline cleanup whose JavaScript unwinding would be
// replaced by generator abandonment. Nested callables retain their own rules.
func FuzzAsyncCleanupRefactor(f *testing.F) {
	startShortBudget(f)
	requireAsyncCleanupQuote(f)
	keys := []string{"catch", "finally", "using", "await-using", "for-await", "nested-try", "nested-using", "nested-await-using"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(5))
		f.Add(key, uint8(10))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		body, offer := "", false
		switch key {
		case "finally":
			body = "try { return await input } finally { const cleaned = 1 }"
		case "using":
			body = "using handle = resource; return await input"
		case "await-using":
			body = "await using handle = resource; return await input"
		case "for-await":
			body = "for await (const item of stream) { return item }; return 0"
		case "nested-try":
			body, offer = "function inner() { try { return 1 } catch { return 0 } }; return await input", true
		case "nested-using":
			body, offer = "function inner() { using handle = resource }; return await input", true
		case "nested-await-using":
			body, offer = "async function inner() { await using handle = resource }; return await input", true
		default:
			key, body = "catch", "try { return await input } catch { return 0 }"
		}
		params := "(input: Promise<number>, resource: Disposable & AsyncDisposable, stream: AsyncIterable<number>)"
		marker := "ASYNC"
		if mode&4 != 0 {
			marker += " /* async 😀 */"
		}
		source := "export " + marker + " function load" + params + " { " + body + " }"
		switch mode % 3 {
		case 1:
			source = "export const load = " + marker + " " + params + " => { " + body + " }"
		case 2:
			source = "export class Loader { " + marker + " load" + params + " { " + body + " } }"
		}
		if mode&8 != 0 {
			source = "const café = '😀';\n" + source
		}
		cursor := strings.Index(source, "ASYNC")
		source = strings.Replace(source, "ASYNC", "async", 1)
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzAsyncCleanupRefactor", files)
		defer result.Remove()
		e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: result, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(result.Dir, "main.vibe")}
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
		position := newToolsLines(source).position(cursor)
		response, ok := toolsRequest(e, "async cleanup refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        lsproto.Range{Start: position, End: position},
				Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}},
			})
		})
		if !ok {
			t.Fatal("no refactor response")
		}
		count := 0
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				if action := item.CodeAction; action != nil && strings.HasPrefix(action.Title, "Convert to a VibeLang function") {
					count++
				}
			}
		}
		want := 0
		if offer {
			want = 2
		}
		if count != want {
			Gap(t, "FuzzAsyncCleanupRefactor", "async-refactor:cleanup:"+key, "%s; offered %d conversions, want %d\n%s", asyncCleanupQuote, count, want, e.archive)
		}
	})
}
