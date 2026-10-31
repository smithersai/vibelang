package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorGoldens(t *testing.T) {
	for _, test := range []struct{ title, want string }{
		{"Convert to a VibeLang function", "export function load(input: Promise<number>) { return try Effect.tryPromise(() => input) }"},
		{"Convert to a VibeLang function with an error per await", "error PromiseFailed { cause: unknown }\nexport function load(input: Promise<number>) { return try Effect.tryPromise({ try: () => input, catch: (cause) => new PromiseFailed({ cause }) }) }"},
	} {
		t.Run(test.title, func(t *testing.T) {
			const source = "export async function load(input: Promise<number>) { return await input }"
			program, file, service, converters := editorProgram(t, source)
			pos := strings.Index(source, "load")
			var chosen *ls.CodeAction
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if action.Description == test.title {
					chosen = action
				}
			}
			if chosen == nil {
				t.Fatalf("missing action %q", test.title)
			}
			got := applyEditorEdits(t, file, converters, chosen.Changes)
			if got != test.want {
				t.Fatalf("async edit differs:\ngot: %s\nwant: %s", got, test.want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("async refactor: %s", d.String())
				}
			}
		})
	}
}

// A declaration without export starts at async, so the inserted error declaration
// shares its start with the edit that removes async. LSP 3.17 allows that only
// as the insert first; lspApply applies edits by that rule, as editors do.
func TestEditorAsyncRefactorUnexportedDeclaration(t *testing.T) {
	const source = "async function load(input: Promise<number>) { return await input }"
	const want = "error PromiseFailed { cause: unknown }\nfunction load(input: Promise<number>) { return try Effect.tryPromise({ try: () => input, catch: (cause) => new PromiseFailed({ cause }) }) }"
	program, file, service, converters := editorProgram(t, source)
	pos := strings.Index(source, "load")
	var chosen *ls.CodeAction
	for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
		if action.Description == "Convert to a VibeLang function with an error per await" {
			chosen = action
		}
	}
	if chosen == nil {
		t.Fatal("missing action")
	}
	type span struct {
		start, end int
		text       string
	}
	var spans []span
	for _, edit := range chosen.Changes {
		r := converters.FromLSPRangeToOriginal(file, edit.Range)
		spans = append(spans, span{r.Pos(), r.End(), edit.NewText})
	}
	slices.SortStableFunc(spans, func(a, b span) int { return a.start - b.start })
	var got strings.Builder
	last := 0
	for i, s := range spans {
		if i > 0 && s.start < spans[i-1].end {
			t.Fatalf("edits overlap at bytes %d-%d and %d-%d", spans[i-1].start, spans[i-1].end, s.start, s.end)
		}
		got.WriteString(source[last:s.start] + s.text)
		last = s.end
	}
	got.WriteString(source[last:])
	if got.String() != want {
		t.Fatalf("async edit differs:\ngot: %s\nwant: %s", got.String(), want)
	}
}

func TestEditorContextualCompletions(t *testing.T) {
	for _, test := range []struct {
		source string
		labels []string
	}{
		{`function main() { Effect.sleep("2 mi/*cursor*/") }`, []string{"2 millis", "2 seconds", "2 minutes"}},
		{`function main() { Effect.sleep("1 /*cursor*/") }`, []string{"1 milli", "1 second", "1 minute"}},
		{`const CustomerId = Schema.String.pipe(Schema.brand("/*cursor*/"))`, []string{"CustomerId"}},
		{`const text = "2 mi/*cursor*/"`, nil},
	} {
		pos := strings.Index(test.source, "/*cursor*/")
		source := strings.ReplaceAll(test.source, "/*cursor*/", "")
		program, file, _, _ := editorProgram(t, source)
		program.GetSemanticDiagnostics(t.Context(), file)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		items := vibelangTextCompletions(c, file, pos)
		done()
		labels := map[string]bool{}
		for _, item := range items {
			labels[item.Label] = true
			if item.Start > pos || item.End < pos || item.End > len(source) {
				t.Fatalf("invalid contextual replacement: %+v", item)
			}
		}
		if test.labels == nil && len(items) != 0 {
			t.Errorf("ordinary string received contextual completions: %+v", items)
		}
		for _, label := range test.labels {
			if !labels[label] {
				t.Errorf("%s: missing %q in %v", source, label, labels)
			}
		}
	}
}

func TestEditorPreludeCompletions(t *testing.T) {
	program, file, _, _ := editorProgram(t, "function main() { return Effect.succeed(1) }")
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	location := astnav.GetTouchingToken(file, strings.Index(file.Text(), "return"))
	names := map[string]bool{}
	for _, symbol := range preludeCompletions(c, location, ast.SymbolFlagsValue) {
		names[symbol.Name()] = true
		if strings.HasPrefix(symbol.Name(), "$") {
			t.Errorf("compiler helper offered as a prelude completion: %s", symbol.Name())
		}
	}
	for _, name := range []string{"Effect", "Layer", "Schema", "Console", "Stream", "fork", "wire"} {
		if !names[name] {
			t.Errorf("missing global prelude completion %s", name)
		}
	}
}
