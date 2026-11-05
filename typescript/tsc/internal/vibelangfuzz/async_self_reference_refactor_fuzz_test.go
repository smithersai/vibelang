package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const asyncSelfReferenceQuote = "Calling an `effect` function returns its Effect unrun, as calling an `async` function returns a Promise."

func requireAsyncSelfReferenceQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), asyncSelfReferenceQuote) {
		t.Fatalf("missing function-kind rule: %q", asyncSelfReferenceQuote)
	}
}

func TestAsyncSelfReferenceRefactorQuoted(t *testing.T) { requireAsyncSelfReferenceQuote(t) }

// Converting a self-reference changes its result from Promise to Effect; the
// await bridge cannot keep treating it as a Promise. Decline until the action
// also rewrites the recursive references. Shadowed names and types are controls.
func FuzzAsyncSelfReferenceRefactor(f *testing.F) {
	startShortBudget(f)
	requireAsyncSelfReferenceQuote(f)
	keys := []string{"declaration", "expression", "arrow", "property-arrow", "property-value", "symbol", "computed", "method", "element", "private", "static", "field-arrow", "alias", "nested", "default", "ordinary-control", "shadow-control", "property-control", "type-control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		name := fmt.Sprintf("load%d", mode)
		body := "if (n > 0) return await " + name + "(n - 1); return 0"
		source := "export ASYNC function " + name + "(n: number): Promise<number> { " + body + " }"
		offer := false
		switch key {
		case "expression":
			source = "export const " + name + " = ASYNC function recur(n: number): Promise<number> { if (n > 0) return await recur(n - 1); return 0 }"
		case "arrow":
			source = "export const " + name + " = ASYNC (n: number): Promise<number> => n > 0 ? await " + name + "(n - 1) : 0"
		case "property-arrow":
			source = "export const holder = { " + name + ": ASYNC (n: number): Promise<number> => n > 0 ? await holder." + name + "(n - 1) : 0 }"
		case "property-value":
			source = "declare function retain(f: (n: number) => Promise<number>): void; export const holder = { " + name + ": ASYNC (n: number): Promise<number> => { retain(holder." + name + "); return await Promise.resolve(n) } }"
		case "symbol", "computed":
			init := "Symbol()"
			if key == "computed" {
				init = "\"" + name + "\""
			}
			source = "const key = " + init + "; export class Loader { ASYNC [key](n: number): Promise<number> { if (n > 0) return await this[key](n - 1); return 0 } }"
		case "method", "element", "private":
			member := name
			call := "this." + member
			if key == "element" {
				call = "this[\"" + member + "\"]"
			}
			if key == "private" {
				member = "#" + name
				call = "this." + member
			}
			source = "export class Loader { ASYNC " + member + "(n: number): Promise<number> { if (n > 0) return await " + call + "(n - 1); return 0 } }"
		case "static":
			source = "export class Loader { static ASYNC " + name + "(n: number): Promise<number> { if (n > 0) return await Loader." + name + "(n - 1); return 0 } }"
		case "field-arrow":
			source = "export class Loader { " + name + " = ASYNC (n: number): Promise<number> => n > 0 ? await this." + name + "(n - 1) : 0 }"
		case "alias":
			source = "export ASYNC function " + name + "(n: number): Promise<number> { const recur = " + name + "; if (n > 0) return await recur(n - 1); return 0 }"
		case "nested":
			source = "export ASYNC function " + name + "(n: number): Promise<number> { const recur = async () => await " + name + "(n - 1); if (n > 0) return await recur(); return 0 }"
		case "default":
			source = "export ASYNC function " + name + "(n: number, recur: (n: number) => Promise<number> = " + name + "): Promise<number> { if (n > 0) return await recur(n - 1); return 0 }"
		case "ordinary-control", "shadow-control", "property-control", "type-control":
			offer = true
			body = "return await input"
			params := "input: Promise<number>"
			if key == "shadow-control" {
				body = "const recur = async (" + name + ": Promise<number>) => await " + name + "; return await recur(input)"
			}
			if key == "property-control" {
				params = "input: { " + name + ": Promise<number> }"
				body = "return await input." + name
			}
			if key == "type-control" {
				body = "type Own = typeof " + name + "; return await input"
			}
			source = "export ASYNC function " + name + "(" + params + "): Promise<number> { " + body + " }"
		default:
			key = "declaration"
		}
		if mode&1 != 0 {
			source = "// café 😀\n" + source
		}
		cursor := strings.Index(source, "ASYNC")
		source = strings.Replace(source, "ASYNC", "async /* keep */", 1)
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzAsyncSelfReferenceRefactor", files)
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
		response, ok := toolsRequest(e, "async self-reference refactors", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
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
			Gap(t, "FuzzAsyncSelfReferenceRefactor", "async-refactor:self-reference:"+key, "%s; offered %d conversions, want %d\n%s", asyncSelfReferenceQuote, count, want, e.archive)
		}
	})
}
