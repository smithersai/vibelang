package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestAsyncAwaitedDefinitionsQuoted(t *testing.T) { requireAsyncRefactorBridgeQuote(t) }

func FuzzAsyncAwaitedDefinitions(f *testing.F) {
	startShortBudget(f)
	requireAsyncRefactorBridgeQuote(f)
	cases := []struct {
		key, body string
		want      int
	}{
		{"object-method", "const item = { [await input]() { return 1 } }; return 1", 0},
		{"object-getter", "const item = { get [await input]() { return 1 } }; return 1", 0},
		{"object-setter", "const item = { set [await input](value: number) {} }; return 1", 0},
		{"class-method", "class Inner { [await input]() { return 1 } }; return 1", 0},
		{"class-static-method", "class Inner { static [await input]() { return 1 } }; return 1", 0},
		{"class-heritage", "class Inner extends (await base) {}; return 1", 0},
		{"nested-heritage", "class Inner extends (class extends (await base) {}) {}; return 1", 0},
		{"nested-async-method-control", "const item = { async method() { return await input } }; return 1", 1},
		{"nested-async-class-control", "class Inner { async method() { return await input } }; return 1", 1},
		{"nested-async-arrow-control", "const inner = async () => await input; return 1", 1},
		{"computed-inner-async-control", "const item = { [(async () => await input).name]() { return 1 } }; return 1", 1},
		{"outer-await-control", "const key = await input; const item = { [key]() { return 1 } }; return key", 2},
	}
	for _, tc := range cases {
		f.Add(tc.key, uint8(0))
		f.Add(tc.key, uint8(1))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		tc := cases[0]
		for _, candidate := range cases {
			if candidate.key == key {
				tc = candidate
				break
			}
		}
		key = tc.key
		body := tc.body
		if mode&4 != 0 {
			body = strings.ReplaceAll(body, "await input", "await (input)")
			body = strings.ReplaceAll(body, "await base", "await (base)")
		}
		if mode&8 != 0 {
			body = strings.ReplaceAll(body, "await input", "await Promise.resolve(input)")
		}
		source := "export ASYNC function load(input: Promise<\"key\">, base: Promise<new () => object>) { " + body + " }"
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
		r := toolsCompile(t, w, "FuzzAsyncAwaitedDefinitions", files)
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
		response, ok := toolsRequest(e, "async definition heads", func(ls *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return ls.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: e.uri}, Range: lsproto.Range{Start: position, End: position}, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{}}})
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
			edited, _ := e.apply("async-definition:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("missing edit")
			}
			after := toolsCompile(t, w, "FuzzAsyncAwaitedDefinitions", edited)
			valid, errors := toolsErrorFree(after), toolsErrorCounts(after)
			after.Remove()
			if !valid {
				Gap(t, "FuzzAsyncAwaitedDefinitions", "async-definition:types:"+key, "%s; %s leaves an awaited definition in the wrong function context: %v\n%s", asyncRefactorPreservationQuote, action.Title, errors, Archive(edited))
			}
		}
		// An unsupported head may be withheld or rewritten safely. Controls keep
		// the existing conversion available rather than disabling every action.
		if tc.want > 0 && found != tc.want {
			Gap(t, "FuzzAsyncAwaitedDefinitions", "async-definition:control:"+key, "want %d safe conversions, got %d\n%s", tc.want, found, e.archive)
		}
	})
}
