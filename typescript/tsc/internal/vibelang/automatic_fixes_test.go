package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestVibeDiagnosticsHaveNoAutomaticFixes(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"effect shorthand", "export effect work() { return 1 }", 101},
		{"written Effect type", "export const program: Effect.Effect<number> = Effect.succeed(1)", 4833},
		{"reserved binding", "export effect function work() { const fork = 1; return fork }", 1702},
		{"unbraced pattern home", "export function work(xs: unknown[]) { for (const x of xs) if (x is { id: let id }) return id }", 705},
		{"var pattern", "export function work(value: unknown) { if (value is { id: var id }) return id }", 107},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assertNoVibeAutomaticFixes(t, tc.source, tc.code)
		})
	}
}

func assertNoVibeAutomaticFixes(t *testing.T, source string, code int32) {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	found := false
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Source() != diagnosticSource {
			continue
		}
		if d.Code() == code {
			found = true
		}
		pushed := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        pushed.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{pushed}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray != nil && len(*response.CommandOrCodeActionArray) != 0 {
			t.Fatalf("EK%d offered automatic fixes: %+v", d.Code(), *response.CommandOrCodeActionArray)
		}
	}
	if !found {
		t.Fatalf("missing retained EK%d", code)
	}
}

// docs/design/src/007-tooling.md: VibeLang ships no quick fixes or codemods
// of its own before its first release.
func FuzzVibeDiagnosticsHaveNoAutomaticFixes(f *testing.F) {
	for mode := uint8(0); mode < 5; mode++ {
		f.Add(mode, uint8(0), false)
		f.Add(mode, uint8(255), true)
	}
	f.Fuzz(func(t *testing.T, mode, value uint8, comments bool) {
		trivia := " "
		if comments {
			trivia = " /* preserved */ "
		}
		source := ""
		code := int32(101)
		switch mode % 5 {
		case 0:
			source = fmt.Sprintf("export effect%swork%d() { return %d }", trivia, value, value)
		case 1:
			source = fmt.Sprintf("export const%sprogram%d: Effect.Effect<number> = Effect.succeed(%d)", trivia, value, value)
			code = 4833
		case 2:
			source = fmt.Sprintf("export effect function work%d() {%sconst fork = %d; return fork }", value, trivia, value)
			code = 1702
		case 3:
			source = fmt.Sprintf("export function work%d(xs: unknown[]) { for (const x of xs) if (x is { id: let id }) return id }%s", value, trivia)
			code = 705
		case 4:
			source = fmt.Sprintf("export function work%d(value: unknown) { if (value is { id: var id }) return id }%s", value, trivia)
			code = 107
		}
		assertNoVibeAutomaticFixes(t, source, code)
	})
}
