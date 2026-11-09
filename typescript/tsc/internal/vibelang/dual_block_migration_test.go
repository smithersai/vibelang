package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const dualBlockWork = "effect function work() { try sleep(\"1 millis\"); return \"done\" }\n"

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
// error, with a note that gives the effect block spelling.
func TestDualBlockKeepsTypeScriptErrorWithNote(t *testing.T) {
	for _, test := range []struct {
		name, source string
		code         int32
		note         string
	}{
		{"data-first", "export function f() { return withSpan(\"load\") { return work() } }", 2769, "`withSpan` takes its program first: write `withSpan(effect { … }, \"load\")`."},
		{"data-first with one candidate", "export function f() { return timeout(\"1 second\") { return work() } }", 2345, "`timeout` takes its program first: write `timeout(effect { … }, \"1 second\")`."},
		{"curried method", "export function f() { const s = Semaphore.makeUnsafe(1); return s.withPermits(1) { return work() } }", 2554, "`s.withPermits(1)` returns the function that takes the program: write `s.withPermits(1)(effect { … })`."},
	} {
		t.Run(test.name, func(t *testing.T) {
			errors := legacyTrailingBlockErrorsOf(t, dualBlockWork+test.source)
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

// D382 made a block whose appended call type-checked EK1023. The block is
// now a program (VIP-2), which withSpan's data-last options parameter
// rejects, so TypeScript's error stays, with the effect block spelling.
func TestDualBlockOptionsSlotRejectsTheProgram(t *testing.T) {
	errors := legacyTrailingBlockErrorsOf(t, "export function f() { return withSpan(\"k\") { return { attributes: {} } } }")
	if len(errors) != 1 || errors[0].Code() != 2769 || errors[0].Source() != "" {
		t.Fatalf("errors %v, want only TS2769", errors)
	}
	if notes := notesOf(errors[0]); !strings.Contains(notes, "write `withSpan(effect { … }, \"k\")`") {
		t.Fatalf("notes %q lack the effect block spelling", notes)
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
		p = trailingBlockMigrationProgram(p)
		file = p.GetSourceFile(file.FileName())
		p.GetSemanticDiagnostics(t.Context(), file)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		if calls := dualBlockCalls(c, file); len(calls) != 0 {
			t.Errorf("%s: recorded %d dual blocks", source, len(calls))
		}
		done()
	}
}
