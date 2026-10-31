package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const asyncReturnAdoptionQuote = "| `async` | `async function f() { }`, `async () => …`, `async m() { }` (a method) | a Promise, as in TypeScript | `await` waits for a Promise |"

func TestAsyncReturnAdoptionQuoted(t *testing.T) { requireAsyncReturnAdoptionQuote(t) }

func requireAsyncReturnAdoptionQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), asyncReturnAdoptionQuote) {
		t.Fatalf("chapter 001 no longer contains %q", asyncReturnAdoptionQuote)
	}
}

// An async return performs Promise adoption, including after an await.
// Structural object/void/unknown types cannot rule out a hidden thenable.
// These editor actions only replace awaits, so decline uncertain returns;
// explicit void and primitive results are controls, including nested scopes.
func FuzzAsyncReturnAdoption(f *testing.F) {
	startShortBudget(f)
	requireAsyncReturnAdoptionQuote(f)
	for _, key := range []string{"any", "unknown", "object", "empty-object", "record", "array", "callable", "void", "generic", "number", "string-null", "boolean-undefined", "bigint", "symbol"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		typ, safe := "unknown", false
		switch key {
		case "any":
			typ = "any"
		case "object":
			typ = "object"
		case "empty-object":
			typ = "{}"
		case "record":
			typ = "{ tag: number }"
		case "array":
			typ = "number[]"
		case "callable":
			typ = "() => number"
		case "void":
			typ = "void"
		case "generic":
			typ = "T"
		case "number":
			typ, safe = "number", true
		case "string-null":
			typ, safe = "string | null", true
		case "boolean-undefined":
			typ, safe = "boolean | undefined", true
		case "bigint":
			typ, safe = "bigint", true
		case "symbol":
			typ, safe = "symbol", true
		default:
			key = "unknown"
		}
		generic := ""
		if typ == "T" {
			generic = "<T>"
		}
		value := "input"
		awaited := mode&4 != 0
		if awaited {
			typ = "Promise<" + typ + ">"
			value = "await input"
		}
		if mode&32 != 0 {
			value = "void (" + value + ")"
			safe = true
		}
		body := "return " + value
		if mode&8 != 0 {
			body = "function inner() { return input }; " + body
		}
		if mode&16 != 0 {
			body = "if (flag) { " + body + " }; return 0"
		}
		body = "{ " + body + " }"
		params := "(input: " + typ + ", flag = true)"
		source := "export async function load" + generic + params + " " + body
		switch mode % 4 {
		case 1:
			source = "export const load = async " + generic + params + " => " + body
		case 2:
			source = "export class Loader { async load" + generic + params + " " + body + " }"
		case 3:
			source = "export const loader = { async load" + generic + params + " " + body + " }"
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzAsyncReturnAdoption", files)
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
		response, ok := toolsRequest(e, "async return adoption", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri},
				Range:        lsproto.Range{Start: position, End: position},
				Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}},
			})
		})
		if !ok {
			t.Fatal("async refactor request failed")
		}
		count := 0
		if response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				if item.CodeAction != nil && strings.HasPrefix(item.CodeAction.Title, "Convert to a VibeLang function") {
					count++
				}
			}
		}
		want := 0
		if safe {
			want = 1
			if awaited {
				want = 2
			}
		}
		if count != want {
			Gap(t, "FuzzAsyncReturnAdoption", fmt.Sprintf("async-return-adoption:%s", key), "%s; return adoption is uncertain=%t; offered %d conversions, want %d\n%s", asyncReturnAdoptionQuote, !safe, count, want, e.archive)
		}
	})
}
