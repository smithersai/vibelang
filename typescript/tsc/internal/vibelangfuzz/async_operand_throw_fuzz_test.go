package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const asyncOperandThrowQuote = "A `throw` statement or throw expression in the literal is still `EK0401`."

func requireAsyncOperandThrowQuote(t testing.TB) {
	t.Helper()
	requireAsyncRefactorBridgeQuote(t)
	if !strings.Contains(SpecText("003-failures.md"), asyncOperandThrowQuote) {
		t.Fatalf("missing literal throw rule: %q", asyncOperandThrowQuote)
	}
}

func TestAsyncAwaitOperandThrowsQuoted(t *testing.T) { requireAsyncOperandThrowQuote(t) }

func FuzzAsyncAwaitOperandThrows(f *testing.F) {
	startShortBudget(f)
	requireAsyncOperandThrowQuote(f)
	cases := []struct {
		name, body string
		want       int
	}{
		{"throw-number", "const v = await do { if (stop) throw 7; input }; return v", 0},
		{"throw-error", "const v = await do { if (stop) throw new Error('bad'); input }; return v", 0},
		{"parenthesized-throw", "const v = await (do { if (stop) throw 7; input }); return v", 0},
		{"call-argument-throw", "const v = await Promise.resolve(do { if (stop) throw 7; input }); return v", 0},
		{"throw-expression", "const v = await (stop ? throw 7 : input); return v", 0},
		{"conditional-do-throw", "const v = await (stop ? do { throw 7 } : input); return v", 0},
		{"outside-operand-control", "if (stop) throw 7; const v = await input; return v", 2},
		{"nested-async-arrow-control", "const v = await do { const nested = async () => { throw 7 }; input }; return v", 2},
		{"nested-async-method-control", "const v = await do { const nested = { async method() { throw 7 } }; input }; return v", 2},
		{"awaited-async-value-control", "await Promise.resolve(async function nested() { throw 7 }); return 1", 2},
		{"throwing-call-control", "const v = await do { JSON.parse('null'); input }; return v", 2},
		{"promise-control", "const v = await input; return v", 2},
	}
	for _, tc := range cases {
		f.Add(tc.name, uint8(0))
		f.Add(tc.name, uint8(9))
		f.Add(tc.name, uint8(16))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		tc := cases[0]
		for _, candidate := range cases {
			if candidate.name == key {
				tc = candidate
				break
			}
		}
		key = tc.name
		body := tc.body
		if mode&4 != 0 {
			body = strings.ReplaceAll(body, "await ", "await /* operand */ ")
		}
		source := "export ASYNC function load(input: Promise<number>, stop: boolean) { " + body + " }"
		if mode&8 != 0 {
			source = "export const load = ASYNC (input: Promise<number>, stop: boolean) => { " + body + " }"
		}
		if mode&16 != 0 {
			source = "export class Loader { ASYNC load(input: Promise<number>, stop: boolean) { " + body + " } }"
		}

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
		r := toolsCompile(t, w, "FuzzAsyncAwaitOperandThrows", files)
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
		response, ok := toolsRequest(e, "async await operand throws", func(ls *ls.LanguageService) (lsproto.CodeActionResponse, error) {
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
			edited, _ := e.apply("async-operand-throw:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("missing edit")
			}
			after := toolsCompile(t, w, "FuzzAsyncAwaitOperandThrows", edited)
			valid, errors := toolsErrorFree(after), toolsErrorCounts(after)
			after.Remove()
			if !valid {
				Gap(t, "FuzzAsyncAwaitOperandThrows", "async-operand-throw:types:"+key, "%s; %s moves a throw into a plain Promise callback: %v\n%s", asyncRefactorPreservationQuote, action.Title, errors, Archive(edited))
			}
		}
		// Keep throws outside the operand and nested async callables eligible.
		if found != tc.want {
			Gap(t, "FuzzAsyncAwaitOperandThrows", "async-operand-throw:control:"+key, "want %d safe conversions, got %d\n%s", tc.want, found, e.archive)
		}
	})
}
