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
const asyncGeneratorRefactorQuote = "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable."
const asyncGeneratorValueReturnQuote = "`return value` in a producer is a compile error, because a Stream has no return value."

func requireAsyncGeneratorRefactorQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("../vips/0021-producers.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), asyncGeneratorValueReturnQuote) {
		t.Fatalf("missing producer result rule: %q", asyncGeneratorValueReturnQuote)
	}
	if !strings.Contains(string(chapter), asyncGeneratorRefactorQuote) {
		t.Fatalf("VIP-21 no longer contains %q", asyncGeneratorRefactorQuote)
	}
}

//gate:spec-tests
func TestAsyncGeneratorRefactorsQuoted(t *testing.T) { requireAsyncGeneratorRefactorQuote(t) }

// Keys cover generator declarations, expressions and methods, valued returns,
// Promise yields, and ordinary async controls with nested generators.
func FuzzAsyncGeneratorRefactors(f *testing.F) {
	startShortBudget(f)
	requireAsyncGeneratorRefactorQuote(f)
	for _, key := range []string{"declaration", "expression", "class-method", "static-method", "object-method", "ordinary", "nested-generator"} {
		f.Add(key, uint8(0), uint8(1))
		f.Add(key, uint8(3), uint8(7))
		f.Add(key, uint8(20), uint8(7))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode, value uint8) {
		switch key {
		case "declaration", "expression", "class-method", "static-method", "object-method", "ordinary", "nested-generator":
		default:
			key = "declaration"
		}
		operand := []string{"input", "(input)", "Promise.resolve(input)", "(Promise.resolve(input))"}[mode%4]
		gap := " "
		if mode&16 != 0 {
			gap = " /* async modifier */ "
		}
		body := fmt.Sprintf("{ yield await %s; return %d }", operand, value)
		if mode&1 != 0 {
			body = "{ yield " + operand + " }"
		}
		source := "async" + gap + "function* values(input: Promise<number>) " + body
		generator := true
		switch key {
		case "expression":
			source = "const values = async" + gap + "function* named(input: Promise<number>) " + body
		case "class-method":
			source = "class Values { async" + gap + "*read(input: Promise<number>) " + body + " }"
		case "static-method":
			source = "class Values { static async" + gap + "*read(input: Promise<number>) " + body + " }"
		case "object-method":
			source = "const values = { async" + gap + "*read(input: Promise<number>) " + body + " }"
		case "ordinary":
			generator = false
			source = "async" + gap + "function values(input: Promise<number>) { return await " + operand + " }"
		case "nested-generator":
			generator = false
			source = "async" + gap + "function values(input: Promise<number>) { const local = async function*() { yield 1; return 2 }; return await " + operand + " }"
		}
		if mode&4 != 0 {
			source = "const café = '😀';" + string(rune(10)) + source
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzAsyncGeneratorRefactors", files)
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
		if !ok {
			t.Fatal("async refactor request failed")
		}
		if response.CommandOrCodeActionArray == nil {
			if generator {
				return
			}
			t.Fatal("ordinary async control has no action response")
		}
		found := 0
		for _, item := range *response.CommandOrCodeActionArray {
			action := item.CodeAction
			if action == nil || !strings.HasPrefix(action.Title, "Convert to a VibeLang function") {
				continue
			}
			found++
			if generator {
				Gap(t, "FuzzAsyncGeneratorRefactors", "async-generator:offered:"+key, "%s; %s; Promise refactor would change generator completion or Promise-yield behavior: %s", asyncGeneratorRefactorQuote, asyncGeneratorValueReturnQuote, Archive(files))
				return
			}
			edited, _ := e.apply("async-generator:"+key, action.Title, action.Edit)
			if edited == nil {
				t.Fatal("ordinary async control was not edited")
			}
			want := "try Effect.tryPromise(() => " + operand + ")"
			if strings.HasSuffix(action.Title, "with an error per await") {
				want = "try Effect.tryPromise({ try: () => " + operand + ", catch: (cause) => new "
			}
			if !strings.Contains(edited["main.vibe"], want) {
				Gap(t, "FuzzAsyncGeneratorRefactors", "async-generator:ordinary-control:"+key, "ordinary async Promise bridge missing: %s", Archive(edited))
			}

		}
		wantActions := 2
		if generator {
			wantActions = 0
		}
		if found != wantActions {
			Gap(t, "FuzzAsyncGeneratorRefactors", "async-generator:actions:"+key, "expected both Promise bridge refactors, got %d\n%s", found, e.archive)
		}
	})
}
