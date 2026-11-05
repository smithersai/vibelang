package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestAsyncBridgeScopeQuoted(t *testing.T) { requireAsyncRefactorBridgeQuote(t) }

func FuzzAsyncBridgeScope(f *testing.F) {
	startShortBudget(f)
	requireAsyncRefactorBridgeQuote(f)
	keys := []string{"block", "block-later", "loop", "switch", "destructure", "class", "function", "deep", "sibling", "nested-function", "type", "control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		body, want := "{ const Effect = 1; return await input }", 0
		switch key {
		case "block":
		case "block-later":
			body = "{ const value = await input; const Effect = 1; return value }"
		case "loop":
			body = "for (const Effect of [1]) { return await input }; return 0"
		case "switch":
			body = "switch (1) { case 1: const Effect = 1; return await input }; return 0"
		case "destructure":
			body = "{ const { Effect } = { Effect: 1 }; return await input }"
		case "class":
			body = "{ class Effect {}; return await input }"
		case "function":
			body = "{ function Effect() {}; return await input }"
		case "deep":
			body = strings.Repeat("{ ", int(mode%4)+1) + body + strings.Repeat(" }", int(mode%4)+1)
		case "sibling":
			body, want = "{ const Effect = 1 }; return await input", 2
		case "nested-function":
			body, want = "function nested(Effect: number) { return Effect }; return await input", 2
		case "type":
			body, want = "{ type Effect = number; return await input }", 2
		case "control":
			body, want = "{ return await input }", 2
		default:
			key = "block"
		}
		source := "type Existing = Effect.Effect<never>; export ASYNC function load(input: Promise<number>) { " + body + " }"
		if mode&2 != 0 {
			source = "// café 😀\n" + source
		}
		pos := strings.Index(source, "ASYNC")
		source = strings.Replace(source, "ASYNC", "async /* keep */", 1)
		file := "main.vibe"
		if mode&1 != 0 {
			file = "main.vibex"
		}
		config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n \"files\": [\"" + file + "\"]\n}"
		files := map[string]string{file: source, "tsconfig.json": config}
		r := toolsCompile(t, w, "FuzzAsyncBridgeScope", files)
		defer r.Remove()
		if !toolsErrorFree(r) {
			t.Fatalf("invalid original: %v\n%s", toolsErrorCounts(r), Archive(files))
		}
		e := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: r, files: files, archive: Archive(files), main: file, uri: toolsURI(r.Dir, file)}
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
		position := newToolsLines(source).position(pos)
		response, ok := toolsRequest(e, "async scope", func(s *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return s.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri}, Range: lsproto.Range{Start: position, End: position},
				Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}},
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
			edited, _ := e.apply("async-scope:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("missing refactor edit")
			}
			after := toolsCompile(t, w, "FuzzAsyncBridgeScope", edited)
			valid, errors := toolsErrorFree(after), toolsErrorCounts(after)
			after.Remove()
			if !valid {
				Gap(t, "FuzzAsyncBridgeScope", "async-scope:types:"+key, "%s; action %s adds errors: %v\n%s", asyncRefactorPreservationQuote, action.Title, errors, Archive(edited))
			}
		}
		if found != want {
			Gap(t, "FuzzAsyncBridgeScope", "async-scope:actions:"+key, "%s; want %d conversions, got %d\n%s", asyncRefactorPreservationQuote, want, found, e.archive)
		}
	})
}
