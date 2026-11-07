package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const asyncOperandJumpQuote = "Bindings and jump targets are resolved on the source before any callback is introduced."

func requireAsyncOperandJumpQuote(t testing.TB) {
	t.Helper()
	requireAsyncRefactorBridgeQuote(t)
	if !strings.Contains(SpecText("008-runtime.md"), asyncOperandJumpQuote) {
		t.Fatalf("missing source jump rule: %q", asyncOperandJumpQuote)
	}
}

func TestAsyncAwaitOperandJumpsQuoted(t *testing.T) { requireAsyncOperandJumpQuote(t) }

func FuzzAsyncAwaitOperandJumps(f *testing.F) {
	startShortBudget(f)
	requireAsyncOperandJumpQuote(f)
	cases := []struct {
		name, body string
		want       int
	}{
		{"return", "const v = await do { if (stop) return 7; input }; return v", 0},
		{"parenthesized-return", "const v = await (do { if (stop) return 7; input }); return v", 0},
		{"call-argument-return", "const v = await Promise.resolve(do { if (stop) return 7; input }); return v", 0},
		{"break", "for (const item of [0]) { const v = await do { if (stop) break; input }; return v }; return 1", 0},
		{"continue", "for (const item of [0]) { const v = await do { if (stop) continue; input }; return v }; return 1", 0},
		{"labeled-break", "outer: for (const item of [0]) { const v = await do { if (stop) break outer; input }; return v }; return 1", 0},
		{"labeled-continue", "outer: for (const item of [0]) { const v = await do { if (stop) continue outer; input }; return v }; return 1", 0},
		{"local-break-control", "const v = await do { local: { if (stop) break local; } input }; return v", 2},
		{"local-loop-control", "const v = await do { for (const item of [0]) { if (stop) continue; break }; input }; return v", 2},
		{"local-switch-control", "const v = await do { switch (stop) { case true: break; default: break }; input }; return v", 2},
		{"nested-function-control", "const v = await do { const nested = () => { return 7 }; input }; return v", 2},
		{"nested-method-control", "const v = await do { const nested = { method() { return 7 } }; input }; return v", 2},
		{"outside-operand-control", "if (stop) return 7; const v = await input; return v", 2},
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
		r := toolsCompile(t, w, "FuzzAsyncAwaitOperandJumps", files)
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
		response, ok := toolsRequest(e, "async await operand jumps", func(ls *ls.LanguageService) (lsproto.CodeActionResponse, error) {
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
			edited, _ := e.apply("async-operand-jump:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("missing edit")
			}
			after := toolsCompile(t, w, "FuzzAsyncAwaitOperandJumps", edited)
			valid, errors := toolsErrorFree(after), toolsErrorCounts(after)
			after.Remove()
			if !valid {
				Gap(t, "FuzzAsyncAwaitOperandJumps", "async-operand-jump:types:"+key, "%s; %s moves a jump into a Promise callback: %v\n%s", asyncRefactorPreservationQuote, action.Title, errors, Archive(edited))
			}
		}
		// Keep safe local jumps and nested callables eligible.
		if found != tc.want {
			Gap(t, "FuzzAsyncAwaitOperandJumps", "async-operand-jump:control:"+key, "want %d safe conversions, got %d\n%s", tc.want, found, e.archive)
		}
	})
}
