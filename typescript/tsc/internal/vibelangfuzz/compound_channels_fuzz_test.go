package vibelangfuzz

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const compoundChannelQuote = "EffectOperand = an ordinary TypeScript source type at the type-operator level (a primary type with postfix [] and [K], optionally after keyof, unique, readonly or infer), never an unparenthesized EffectType"

func TestCompoundChannelsQuoted(t *testing.T) { requireCompoundChannelQuote(t) }
func requireCompoundChannelQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), compoundChannelQuote) {
		t.Fatalf("Appendix A no longer contains %q", compoundChannelQuote)
	}
	tooling, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	const safeFix = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(string(tooling), safeFix) {
		t.Fatal(safeFix)
	}

}

// EK4833 must print operands at the grammar's type-operator level.
// Exercise all three channels, quoted operators and nested array operators.
// R remains present: omitted-R spelling has a separate implementation owner.
func FuzzCompoundChannelQuickFix(f *testing.F) {
	startShortBudget(f)
	requireCompoundChannelQuote(f)
	for _, key := range []string{"union", "intersection", "mixed", "array", "literal"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
	}
	f.Add("mixed", uint8(5))
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		a, aw := "number | string", "(number | string)"
		e, ew := "E | F", "(E | F)"
		r, rw := "R | S", "(R | S)"
		switch key {
		case "intersection":
			a, aw = "A & B", "(A & B)"
			e, ew = "E & F", "(E & F)"
			r, rw = "R & S", "(R & S)"
		case "mixed":
			e, ew = "E & F", "(E & F)"
			r, rw = "R", "R"
		case "array":
			a, aw = "(number | string)[]", "(number | string)[]"
		case "literal":
			a, aw = "\"left|right\"", "\"left|right\""
		default:
			key = "union"
		}
		if mode&1 != 0 {
			e, ew = "E", "E"
		}
		if mode&2 != 0 {
			r, rw = "R & S", "(R & S)"
		}
		if mode&4 != 0 {
			a, aw = "Box<number | string>", "Box<number | string>"
		}
		head := "type A={a:number};type B={b:string};type E={e:1};type F={f:2};type R={r:1};type S={s:2};type Box<T>=ReadonlyArray<T>;\n"
		if mode&8 != 0 {
			head = "const café = '😀';\n" + head
		}
		source := head + "export type Program = Effect.Effect<" + a + ", " + e + ", " + r + ">\n"
		want := head + "export type Program = " + aw + "!" + ew + "!" + rw + "\n"
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzCompoundChannelQuickFix", files)
		defer result.Remove()
		editor := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: result, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(result.Dir, "main.vibe")}
		var err error
		editor.run("didOpen", func() {
			editor.session.DidOpenFile(editor.ctx, editor.uri, 1, source, toolsLanguage)
			editor.service, err = editor.session.GetLanguageService(editor.ctx, editor.uri)
		})
		defer func() {
			if sessions.current == editor.session {
				editor.run("didClose", func() { editor.session.DidCloseFile(editor.ctx, editor.uri) })
			}
		}()
		if err != nil {
			t.Fatal(err)
		}
		// Public hover is the writer oracle even when the code action must
		// refuse under the safe-repair contract (007, details260/277).
		hover, hoverOK := toolsRequest(editor, "compound type hover", func(service *ls.LanguageService) (lsproto.HoverResponse, error) {
			return service.ProvideHover(t.Context(), &lsproto.HoverParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri},
				Position:     newToolsLines(source).position(strings.Index(source, "Program =")),
			})
		})
		wantHover := "type Program = " + strings.ReplaceAll(aw+"!"+ew+"!"+rw, "number | string", "string | number")
		if !hoverOK || !strings.Contains(compoundChannelHoverText(hover), wantHover) {
			Gap(t, "FuzzCompoundChannelQuickFix", "compound-hover:"+key, "%s; hover %q, want %q", compoundChannelQuote, compoundChannelHoverText(hover), wantHover)
		}
		items, err := toolsDiagnostics(t.Context(), editor.service, editor.uri)
		if err != nil {
			t.Fatal(err)
		}
		var diagnostic *lsproto.Diagnostic
		for _, item := range items {
			if code, _ := toolsDiagnosticCode(item); code == 4833 {
				diagnostic = item
				break
			}
		}
		if diagnostic == nil {
			t.Fatal("missing EK4833 on explicit Effect type")
		}
		encoded, _ := json.Marshal(diagnostic)
		refused := strings.Contains(string(encoded), "No quick fix")
		response, ok := toolsRequest(editor, "compound type quick fix", func(service *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri}, Range: diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}}})
		})
		if !ok {
			t.Fatal("compound type code action request failed")
		}
		if response.CommandOrCodeActionArray == nil {
			if refused {
				return
			}
			t.Fatal("missing compound type code actions without a refusal reason")
		}
		found := false
		for _, item := range *response.CommandOrCodeActionArray {
			action := item.CodeAction
			if action == nil || action.Edit == nil {
				continue
			}
			edited, _ := editor.apply("compound-type:"+key, action.Title, action.Edit)
			if edited == nil || !strings.Contains(edited["main.vibe"], "export type Program = ") || strings.Contains(edited["main.vibe"], "Effect.Effect<") {
				continue
			}
			if refused {
				Gap(t, "FuzzCompoundChannelQuickFix", "compound-type:unsafe-action", "the diagnostic refuses its automatic rewrite, but the server edits it: %s", action.Title)
			}
			found = true
			if got := edited["main.vibe"]; got != want {
				Gap(t, "FuzzCompoundChannelQuickFix", "compound-type:"+key, "%s; want:\n%s\ngot:\n%s", compoundChannelQuote, want, got)
			}
		}
		if !found && !refused {
			Gap(t, "FuzzCompoundChannelQuickFix", "compound-type:missing-action", "no EK4833 shorthand action\n%s", source)
		}
	})
}

func compoundChannelHoverText(response lsproto.HoverResponse) string {
	if response.Hover == nil {
		return ""
	}
	content := response.Hover.Contents
	switch {
	case content.MarkupContent != nil:
		return content.MarkupContent.Value
	case content.String != nil:
		return *content.String
	case content.MarkedStringWithLanguage != nil:
		return content.MarkedStringWithLanguage.Value
	}
	return ""
}
