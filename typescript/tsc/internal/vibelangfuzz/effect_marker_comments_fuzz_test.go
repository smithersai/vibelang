package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

var effectMarkerTrivia = []struct{ key, text string }{
	{"block-keyword", "/* function */ "},
	{"line-keyword", "// function\n"},
	{"multiline-keyword", "/*\nfunction\n*/ "},
	{"block-substring", "/* functionally */ "},
	{"identifier-suffix", "/* malfunction */ "},
	{"two-comments", "/* first */ /* function */ "},
	{"unicode-keyword", "/* 🦊 function café */ "},
}

func effectMarkerCommentQuotes(t testing.TB) {
	t.Helper()
	for _, rule := range []struct{ chapter, quote string }{
		{"001-functions.md", "an ordinary async callable or native generator keeps its own \x60await\x60 or \x60yield\x60 rules"},
		{"001-functions.md", "\x60effect\x60 goes exactly where TypeScript allows \x60async\x60, and nowhere else (VIP-1)"},
		{"002-running.md", "\x60try\x60 outside effect code; the same rule applies to \x60try.all\x60, \x60try.race\x60, \x60try.any\x60 or \x60try.allSettled\x60 | \x60EK0501\x60"},
		{"007-tooling.md", "Quick fixes use the formatter to preserve the parse under Appendix A."},
		{"007-tooling.md", "preserves evaluation order, coldness, types, comments, and declaration output"},
	} {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q", rule.chapter, rule.quote)
		}
	}
}

func TestEffectMarkerCommentsQuoted(t *testing.T) { effectMarkerCommentQuotes(t) }

func FuzzEffectMarkerComments(f *testing.F) {
	startShortBudget(f)
	effectMarkerCommentQuotes(f)
	for _, c := range effectMarkerTrivia {
		for mode := range uint8(8) {
			f.Add(c.key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		c := effectMarkerTrivia[0]
		if len(key) != 0 {
			c = effectMarkerTrivia[int(key[0])%len(effectMarkerTrivia)]
		}
		for _, candidate := range effectMarkerTrivia {
			if candidate.key == key {
				c = candidate
				break
			}
		}
		prefix, head, closing, wantAction := "export "+c.text, "function load()", "", true
		switch mode % 8 {
		case 1:
			prefix = "export default " + c.text
		case 2:
			prefix, head, closing = "export const load = "+c.text, "function named()", ";"
		case 3:
			prefix, head, closing = "export const api = { "+c.text, "load()", " };"
		case 4:
			head, wantAction = "async function load()", false
		case 5:
			head, wantAction = "function* load(): Generator<number, number, unknown>", false
		case 6:
			head, wantAction = "async function* load()", false
		case 7:
			prefix, head, closing = "export const load = "+c.text, "() =>", ";"
		}
		tail := " { return try Effect.succeed(1) }" + closing + "\n"
		imports := "import { Effect } from \"effect\";\n"
		source, expected := imports+prefix+head+tail, imports+prefix+"effect "+head+tail
		before, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		var diagnostic *ast.Diagnostic
		for _, d := range before.Diagnostics {
			if d.Source() == "EK" && d.Code() == 501 {
				if diagnostic != nil {
					t.Fatal("expected exactly one EK0501")
				}
				diagnostic = d
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzEffectMarkerComments", fmt.Sprintf("%s:mode%d:diagnostic", c.key, mode%8), "chapter 002 requires EK0501 outside effect code: %v", Keys(before.Dir, before.Diagnostics))
			return
		}
		file := before.SourceFile("main.vibe")
		service, converters := toolsService(w, before.Program, file.FileName())
		item := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
		uri := lsconv.FileNameToDocumentURI(file.FileName())
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		actions, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: item.Range,
			Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{item}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		var fixed []string
		if actions.CommandOrCodeActionArray != nil {
			for _, entry := range *actions.CommandOrCodeActionArray {
				action := entry.CodeAction
				if action == nil || action.Edit == nil || !strings.HasPrefix(action.Title, "Write effect ") {
					continue
				}
				edits, ok := toolsWorkspaceEdits(action.Edit)
				if !ok || len(edits) != 1 {
					t.Fatal("the marker repair must edit only its source file")
				}
				text, _, err := toolsApply(source, edits[uri])
				if err != nil {
					t.Fatal(err)
				}
				fixed = append(fixed, text)
			}
		}
		gapKey, want := fmt.Sprintf("%s:mode%d", c.key, mode%8), 1
		if !wantAction {
			want = 0
		}
		if len(fixed) != want {
			Gap(t, "FuzzEffectMarkerComments", gapKey, "marker eligibility: got %d actions, want %d", len(fixed), want)
			return
		}
		if !wantAction {
			return
		}
		if fixed[0] != expected {
			Gap(t, "FuzzEffectMarkerComments", gapKey, "VIP-1 requires the marker before the real function; chapter 007 preserves comments:\ngot:\n%s\nwant:\n%s", fixed[0], expected)
			return
		}
		after, err := w.Compile(t.Context(), Single(fixed[0]))
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if HasError(after.Diagnostics) {
			Gap(t, "FuzzEffectMarkerComments", gapKey, "the actual editor edit must compile: %v\n%s", Keys(after.Dir, after.Diagnostics), fixed[0])
		}
	})
}
