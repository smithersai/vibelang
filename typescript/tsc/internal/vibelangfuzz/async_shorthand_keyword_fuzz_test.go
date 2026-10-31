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
const asyncShorthandKeywordQuote = "There is no top-level shorthand: `effect load() { }` and `async load() { }` outside a class or object literal are syntax errors, with a quick fix that inserts `function`."

func requireAsyncShorthandKeywordQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), asyncShorthandKeywordQuote) {
		t.Fatalf("chapter 001 no longer contains %q", asyncShorthandKeywordQuote)
	}
}

func TestAsyncShorthandKeywordPrefixQuoted(t *testing.T) { requireAsyncShorthandKeywordQuote(t) }

// Keys pin recovered shorthand names and canonical declaration, expression
// and method controls. Bytes vary Promise operands, comments and Unicode offsets.
func FuzzAsyncShorthandKeywordPrefix(f *testing.F) {
	startShortBudget(f)
	requireAsyncShorthandKeywordQuote(f)
	for _, key := range []string{"functionality", "functionary", "function1", "function_", "function$", "functionπ", "later", "canonical", "method", "expression"} {
		f.Add(key, uint8(0), uint8(1))
		f.Add(key, uint8(3), uint8(7))
		f.Add(key, uint8(20), uint8(7))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode, value uint8) {
		switch key {
		case "functionality", "functionary", "function1", "function_", "function$", "functionπ", "later", "canonical", "method", "expression":
		default:
			key = "functionality"
		}
		operand := []string{"input", "(input)", "Promise.resolve(input)", "(Promise.resolve(input))"}[mode%4]
		body := fmt.Sprintf("{ const value = await %s; return value + %d }", operand, value)
		name, gap, needKeyword := key, " ", true
		if mode&16 != 0 {
			gap = " /* keep async */ "
		}
		source := "export async" + gap + name + "(input: Promise<number>) " + body
		switch key {
		case "canonical":
			name = "functionality"
			source = "export async" + gap + "function " + name + "(input: Promise<number>) " + body
		case "method":
			name, needKeyword = "functionality", false
			source = "export class Loader { async" + gap + name + "(input: Promise<number>) " + body + " }"
		case "expression":
			name = "functionality"
			source = "export const load = async" + gap + "function " + name + "(input: Promise<number>) " + body
		}
		if mode&4 != 0 {
			source = "const café = '😀';\n" + source
		}
		if mode&8 != 0 {
			source = strings.Replace(source, "await ", "await /* promise */ ", 1)
		}
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, "FuzzAsyncShorthandKeywordPrefix", files)
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
			checked := toolsCompile(t, w, "FuzzAsyncShorthandKeywordPrefix", edited)
			if HasError(checked.Diagnostics) {
				Gap(t, "FuzzAsyncShorthandKeywordPrefix", "async-shorthand:checks:"+key, "%s; edited source after %s has errors: %v\n%s", asyncShorthandKeywordQuote, action.Title, Keys(checked.Dir, checked.Diagnostics), Archive(edited))
			}
			checked.Remove()
			hasKeyword := strings.Contains(got, "function "+name+"(") || strings.Contains(got, "function"+gap+name+"(")
			if hasKeyword != needKeyword {
				Gap(t, "FuzzAsyncShorthandKeywordPrefix", "async-shorthand:keyword:"+key, "%s; wrong function keyword after %s (want %v): %s", asyncShorthandKeywordQuote, action.Title, needKeyword, Archive(edited))
			}
			want := "try Effect.tryPromise(() => " + operand + ")"
			if strings.HasSuffix(action.Title, "with an error per await") {
				want = "try Effect.tryPromise({ try: () => " + operand + ", catch: (cause) => new "
			}
			if !strings.Contains(got, want) || strings.Contains(got, "await ") {
				Gap(t, "FuzzAsyncShorthandKeywordPrefix", "async-refactor:bridge:"+key, "%s; want %q after %s\n%s", asyncShorthandKeywordQuote, want, action.Title, Archive(edited))
			}
		}
		if found != 2 {
			Gap(t, "FuzzAsyncShorthandKeywordPrefix", "async-refactor:actions:"+key, "expected both Promise bridge refactors, got %d\n%s", found, e.archive)
		}
	})
}
