package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A fresh object with an own noncallable data property then is not adopted.
// Aliases, getters and later computed/spread members retain the refusal.
func TestFreshAsyncNonThenableQuoted(t *testing.T) { requireAsyncReturnAdoptionQuote(t) }

func FuzzFreshAsyncNonThenable(f *testing.F) {
	startShortBudget(f)
	requireAsyncReturnAdoptionQuote(f)
	for _, key := range []string{"number", "string", "null", "undefined", "boolean", "getter", "spread", "computed", "alias"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(3))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		primitive, safe := "7", true
		switch key {
		case "string":
			primitive = "\"no\""
		case "null":
			primitive = "null"
		case "undefined":
			primitive = "undefined"
		case "boolean":
			primitive = "false"
		case "getter", "spread", "computed", "alias":
			safe = false
		default:
			key = "number"
		}
		value := "{ then: " + primitive + " }"
		switch key {
		case "getter":
			value = "{ get then() { return 7 } }"
		case "spread":
			value = "{ then: 7, ...input }"
		case "computed":
			value = "{ then: 7, [key]: 1 }"
		case "alias":
			value = "input"
		}
		if mode&4 != 0 {
			value = "(" + value + ")"
		}
		if mode&8 != 0 && key != "alias" {
			value = "(" + value + " as const)"
		}
		body := "{ return " + value + " }"
		if mode&16 != 0 {
			body = "{ if (flag) return " + value + "; return 0 }"
		}
		params := "(input: { then: number }, key: string, flag = true)"
		source := "export async function load" + params + " " + body
		switch mode % 4 {
		case 1:
			source = "export const load = async " + params + " => " + body
		case 2:
			source = "export class Loader { async load" + params + " " + body + " }"
		case 3:
			source = "export const loader = { async load" + params + " " + body + " }"
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzFreshAsyncNonThenable", files)
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

		}
		if count != want {
			Gap(t, "FuzzFreshAsyncNonThenable", fmt.Sprintf("fresh-async-nonthenable:%s", key), "%s; return adoption is uncertain=%t; offered %d conversions, want %d\n%s", asyncReturnAdoptionQuote, !safe, count, want, e.archive)
		}
	})
}
