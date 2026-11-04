package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func schemaAliasSeparatorQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{
		"without changing the meaning of TypeScript-style source",
		"preserves evaluation order, coldness, types, comments, and declaration output",
	} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("chapter 007 lost %q", quote)
		}
	}
}
func TestSchemaAliasSeparatorQuoted(t *testing.T) { schemaAliasSeparatorQuotes(t) }

// Static oracle: the following statement must still parse and the schema's
// associated type must still accept the same consumer after either edit path.
func FuzzSchemaAliasSeparator(f *testing.F) {
	startShortBudget(f)
	schemaAliasSeparatorQuotes(f)
	type fixture struct{ key, init, gap, tail, witness string }
	var cases []fixture
	for _, init := range []struct{ key, text, witness string }{
		{"local", "Base", "'ok'"},
		{"property", "holder.current", "'ok'"},
		{"array", "Schema.Array(Base)", "['ok']"},
		{"builtin", "Schema.String", "'ok'"},
	} {
		for _, gap := range []struct{ key, text string }{
			{"tight", ""}, {"space", " "}, {"comment", "/* keep */"}, {"newline", "\n"},
		} {
			for _, tail := range []struct{ key, text string }{
				{"value", "value;"}, {"export", "export function after(){return value;}"},
			} {
				cases = append(cases, fixture{init.key + "-" + gap.key + "-" + tail.key, init.text, gap.text, tail.text, init.witness})
			}
		}
	}
	// The keyed corpus covers every shape; one bootstrap seed avoids
	// executing all 32 shapes twice during short runs.
	f.Add("local-tight-value")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		c := cases[len(key)%len(cases)]
		for _, candidate := range cases {
			if candidate.key == key {
				c = candidate
				break
			}
		}
		key = c.key
		source := "import {Schema} from 'effect';const Base=Schema.String;const Basevalue=Schema.Number;const holder={current:Base};const value=7;\nexport const X=" + c.init + ";export type X=typeof X.Type;" + c.gap + c.tail + "\n"
		project := func(text string) Project { return Single(text) }
		r, err := w.Compile(t.Context(), project(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if !toolsErrorFree(r) {
			t.Fatalf("invalid fixture: %v", r.Diagnostics)
		}
		var diagnostic *ast.Diagnostic
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4841 {
				diagnostic = d
				break
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzSchemaAliasSeparator", key, "missing required schema alias repair")
			return
		}
		file := r.SourceFile("main.vibe")
		service, converters := toolsService(w, r.Program, file.FileName())
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
		editor := ""
		if actions.CommandOrCodeActionArray != nil {
			for _, a := range *actions.CommandOrCodeActionArray {
				if a.CodeAction == nil || !strings.HasPrefix(a.CodeAction.Title, "Write ") || a.CodeAction.Edit == nil {
					continue
				}
				edits, ok := toolsWorkspaceEdits(a.CodeAction.Edit)
				if !ok || len(edits) != 1 {
					t.Fatal("schema edit touches another file")
				}
				editor, _, err = toolsApply(source, edits[uri])
				if err != nil {
					t.Fatal(err)
				}
			}
		}
		if editor == "" {
			Gap(t, "FuzzSchemaAliasSeparator", key, "missing editor edit")
			return
		}
		cli := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{})
		if cli.Err != nil {
			t.Fatal(cli.Err)
		}
		cliText := ""
		count := 0
		for _, file := range cli.Files {
			if file.Counts[4841] > 0 {
				cliText = file.Text
				count += file.Counts[4841]
			}
		}
		if count != 1 {
			Gap(t, "FuzzSchemaAliasSeparator", key, "safe CLI repair missing; refused=%v", cli.Refused)
		}
		for _, edit := range []struct{ path, text string }{{"editor", editor}, {"CLI", cliText}} {
			if edit.text == "" {
				continue
			}
			if !strings.Contains(edit.text, c.gap+c.tail) {
				Gap(t, "FuzzSchemaAliasSeparator", key, "lost following statement/comment (%s): %s", edit.path, edit.text)
			}
			after, err := w.Compile(t.Context(), project(edit.text+"\nexport const witness:X="+c.witness+";\n"))
			if err != nil {
				t.Fatal(err)
			}
			if !toolsErrorFree(after) {
				Gap(t, "FuzzSchemaAliasSeparator", key, "changed parse or associated type (%s): %v\n%s", edit.path, after.Diagnostics, edit.text)
			}
			after.Remove()
		}
		ExpectPending(t, "FuzzSchemaAliasSeparator", key)
	})
}
