package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const dualBlockWork = "function work() { sleep(\"1 millis\"); return \"done\" }\n"

// errorsOf returns the error diagnostics of source's file, with the text of
// their notes.
func errorsOf(t *testing.T, source string) []*ast.Diagnostic {
	t.Helper()
	p, file, _, _ := editorProgram(t, source)
	var errors []*ast.Diagnostic
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d)
		}
	}
	return errors
}

func notesOf(d *ast.Diagnostic) string {
	var notes []string
	for _, chained := range d.MessageChain() {
		notes = append(notes, chained.String())
	}
	return strings.Join(notes, "\n")
}

// D376: a block is its call's last argument, so a block after a dual that
// takes its program first or returns a function of it keeps TypeScript's
// error, with a note that gives the arrow spelling.
func TestDualBlockKeepsTypeScriptErrorWithNote(t *testing.T) {
	for _, test := range []struct {
		name, source string
		code         int32
		note         string
	}{
		{"data-first", "export function f() { return withSpan(\"load\") { return work() } }", 2769, "`withSpan` takes its program first: write `withSpan(() => { … }, \"load\")`."},
		{"data-first with one candidate", "export function f() { return timeout(\"1 second\") { return work() } }", 2345, "`timeout` takes its program first: write `timeout(() => { … }, \"1 second\")`."},
		{"curried method", "export function f() { const s = Semaphore.makeUnsafe(1); return s.withPermits(1) { return work() } }", 2554, "`s.withPermits(1)` returns the function that takes the program: write `s.withPermits(1)(() => { … })`."},
	} {
		t.Run(test.name, func(t *testing.T) {
			errors := errorsOf(t, dualBlockWork+test.source)
			if len(errors) != 1 || errors[0].Source() != "" || errors[0].Code() != test.code {
				t.Fatalf("errors %v, want only TS%d", errors, test.code)
			}
			notes := notesOf(errors[0])
			if !strings.Contains(notes, "A block is its call's last argument. "+test.note) || !strings.Contains(notes, dualBlockMigrationNote) {
				t.Fatalf("notes %q lack %q", notes, test.note)
			}
		})
	}
}

// The block withSpan's data-last options parameter receives is a plain
// callback that pauses, so the appended call draws EK4301 beside TS2769.
// That EK4301 names the misplaced block, so it is dropped; the same arrow
// written as an argument keeps it.
func TestDualBlockDropsTheCallbackCascade(t *testing.T) {
	block := errorsOf(t, dualBlockWork+"export function f() { return withSpan(\"load\") { work(); return {} } }")
	if slices.ContainsFunc(block, func(d *ast.Diagnostic) bool { return d.Code() == EK4301.Code }) {
		t.Fatalf("the block draws EK4301: %v", block)
	}
	arrow := errorsOf(t, dualBlockWork+"export function f() { return withSpan(\"load\", () => { work(); return {} }) }")
	if !slices.ContainsFunc(arrow, func(d *ast.Diagnostic) bool { return d.Source() == diagnosticSource && d.Code() == EK4301.Code }) {
		t.Fatalf("the written arrow draws no EK4301, so the cascade this test guards is gone: %v", arrow)
	}
}

// D382: a block whose appended call type-checks has changed meaning
// silently, which is EK1023 and nothing else.
func TestDualBlockSilentChangeIsEK1023(t *testing.T) {
	errors := errorsOf(t, "export function f() { return withSpan(\"k\") { return { attributes: {} } } }")
	if len(errors) != 1 || errors[0].Code() != EK1023.Code || errors[0].Source() != diagnosticSource {
		t.Fatalf("errors %v, want only EK1023", errors)
	}
	if notes := notesOf(errors[0]); !strings.Contains(notes, "write `withSpan(() => { … }, \"k\")`") {
		t.Fatalf("EK1023's notes %q lack the arrow spelling", notes)
	}
}

// D188 appended these blocks too, so the recorder leaves them alone.
func TestDualBlockRecorderLeavesAppendedForms(t *testing.T) {
	for _, source := range []string{
		"service Users { find(id: string): string!! }\nexport const UsersLive = Layer.effect(Users) { return { find(id) { return id } } }",
		"export function f() { const s = Semaphore.makeUnsafe(1); return Semaphore.withPermits(s, 1) { return 1 } }",
		"export function f() { return Effect.forkChild { return 1 } }",
		"export function f() { return Effect.suspend { return Effect.succeed(1) } }",
		"export function f() { return Effect.Do |> Effect.bind(%, \"value\") { return Effect.succeed(1) } }",
	} {
		p, file, _, _ := editorProgram(t, source)
		p.GetSemanticDiagnostics(t.Context(), file)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		if calls := dualBlockCalls(c, file); len(calls) != 0 {
			t.Errorf("%s: recorded %d dual blocks", source, len(calls))
		}
		done()
	}
}

func TestDualBlockMigrationFixAndIdempotence(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export function f() { return withSpan(\"load\") { return work() } }", "export function f() { return withSpan(() => { return work() }, \"load\") }"},
		{"export function f() {\n  return withSpan(\"x\", { attributes: { a: 1 } }) {\n    return work()\n  }\n}", "export function f() {\n  return withSpan(() => {\n    return work()\n  }, \"x\", { attributes: { a: 1 } })\n}"},
		{"export function f() {\n  return retry({\n    times: 3,\n  }) {\n    return work()\n  }\n}", "export function f() {\n  return retry(() => {\n    return work()\n  }, {\n    times: 3,\n  })\n}"},
		{"export function f() { const s = Semaphore.makeUnsafe(1); return s.withPermits(1) { return work() } }", "export function f() { const s = Semaphore.makeUnsafe(1); return s.withPermits(1)(() => { return work() }) }"},
		{"export function f() { return withSpan(\"k\") { return { attributes: {} } } }", "export function f() { return withSpan(() => { return { attributes: {} } }, \"k\") }"},
		// Nested blocks move in one round: their edits do not overlap.
		{"export function f() { return withSpan(\"outer\") { return timeout(\"1 second\") { return work() } } }", "export function f() { return withSpan(() => { return timeout(() => { return work() }, \"1 second\") }, \"outer\") }"},
	} {
		t.Run(test.source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, dualBlockWork+test.source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("migration: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if fixed.Text != dualBlockWork+test.want {
				t.Fatalf("--fix writes\n%s\nwant\n%s", fixed.Text, dualBlockWork+test.want)
			}
			if errors := errorsOf(t, fixed.Text); len(errors) != 0 {
				t.Fatalf("fixed source reports %v", errors)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("second fix changed the project: %+v", again)
			}
		})
	}
}

// A call with explicit type arguments has no exact rewrite: the data-first
// signature takes other type parameters. --fix refuses it and the error says
// why, so the site never changes silently.
func TestDualBlockMigrationRefusesTypeArguments(t *testing.T) {
	source := dualBlockWork + "export function f() { return withSpan<[]>(\"load\") { return work() } }"
	errors := errorsOf(t, source)
	if !slices.ContainsFunc(errors, func(d *ast.Diagnostic) bool {
		return strings.Contains(notesOf(d), "This block cannot be moved automatically: explicit type arguments")
	}) {
		t.Fatalf("errors %v lack the refusal", errors)
	}
	p, _, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{MigrationOnly: true})
	if len(result.Files) != 0 || len(result.Refused) != 1 || result.Refused[0].Code != EK1023.Code {
		t.Fatalf("migration: %+v", result)
	}
}

// dual-block-legacy-fixed is what vibelang --fix writes for
// dual-block-legacy.fail, apart from the case's expectation line.
func TestDualBlockLegacyCaseFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	dir := copyCompilerFixture(t, filepath.Join(cases, "dual-block-legacy.fail"), root)
	result := fixCase(t, dir)
	if len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("migration: %+v", result)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	want, err := os.ReadFile(filepath.Join(cases, "dual-block-legacy-fixed/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	body := func(text string) string {
		_, rest, _ := strings.Cut(text, "\n")
		return rest
	}
	if body(got) != body(string(want)) {
		t.Fatalf("--fix writes\n%s\nwant\n%s", got, want)
	}
}

// The editor offers the same rewrite as --fix on the site's error, the
// TypeScript error or EK1023.
func TestDualBlockCodeAction(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export function f() { return withSpan(\"load\") { return work() } }", "export function f() { return withSpan(() => { return work() }, \"load\") }"},
		{"export function f() { return withSpan(\"k\") { return { attributes: {} } } }", "export function f() { return withSpan(() => { return { attributes: {} } }, \"k\") }"},
	} {
		program, file, service, converters := editorProgram(t, dualBlockWork+test.source)
		var diagnostic *ast.Diagnostic
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				diagnostic = d
			}
		}
		if diagnostic == nil {
			t.Fatalf("no error in %s", test.source)
		}
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		var chosen *lsproto.CodeAction
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Pass the block where withSpan takes its program") {
					chosen = action.CodeAction
				}
			}
		}
		if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
			t.Fatalf("no code action for %s", test.source)
		}
		changes := *chosen.Edit.Changes
		if got := applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())]); got != dualBlockWork+test.want {
			t.Fatalf("the code action writes\n%s\nwant\n%s", got, dualBlockWork+test.want)
		}
	}
}
