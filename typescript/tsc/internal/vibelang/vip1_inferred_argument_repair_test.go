package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// rule-evidence: docs/design/vips/0001-effect-and-async-functions.md#amendment-inferred-effect-arguments-2026-11-03
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#amendment-inferred-effect-arguments
//
// The repairs of VIP-1's inferred Effect arguments. The editor offers try for
// a direct Effect-valued argument when the enclosing written failure and
// requirement contract accepts it, and checks only those channels. A
// container or callback gets the explicit type arguments action, never try.

const inferredArgumentPrelude = "error Boom\nservice Svc { n: number }\n"

// inferredArgumentTitles returns the quick fix titles offered for the EK4802
// diagnostic on the argument written as argument.
func inferredArgumentTitles(t *testing.T, source, argument string) []string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	at := strings.Index(source, argument)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() != EK4802.Code || d.Pos() != at {
			continue
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
		var titles []string
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil {
					titles = append(titles, action.CodeAction.Title)
				}
			}
		}
		return titles
	}
	t.Fatalf("no EK4802 at %q in:\n%s", argument, source)
	return nil
}

func TestInferredEffectArgumentEditorTry(t *testing.T) {
	for _, test := range []struct {
		name, source, argument string
		try, explicit          bool
	}{
		{"accepted failure contract", "function take<T>(x: T, message?: string): number { return 1 }\neffect function main(job: number!Boom): number!Boom { return take(job) }", "job)", true, false},
		{"rejected failure contract", "function take<T>(x: T, message?: string): number { return 1 }\neffect function main(job: number!Boom): number!! { return take(job) }", "job)", false, false},
		{"rejected requirement contract", "function take<T>(x: T, message?: string): number { return 1 }\neffect function main(job: number!never!Svc): number!! { return take(job) }", "job)", false, false},
		// The action checks the channels, not the edited call's result type,
		// its other arguments or its overloads.
		{"expected result type unchecked", "function take<T>(x: T): T { return x }\neffect function main(job: number!!): number!! { const kept: number!! = take(job); return 1 }", "job)", true, false},
		{"other arguments unchecked", "function take<T>(x: T, y: T): number { return 1 }\neffect function main(job: number!!): number!! { return take(job, job) }", "job, job", true, false},
		{"overloads unchecked", "function take<T>(x: T): number\nfunction take(x: string, y: string): number\nfunction take(x: unknown, y?: unknown): number { return 1 }\neffect function main(job: number!!): number!! { return take(job) }", "job)", true, false},
		{"container", "function take<T>(x: T[]): number { return 1 }\neffect function main(job: number!!): number!! { return take([job]) }", "[job]", false, true},
		{"callback", "function take<T>(f: () => T): number { return 1 }\neffect function main(job: number!!): number!! { return take(() => job) }", "() => job", false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			titles := inferredArgumentTitles(t, inferredArgumentPrelude+test.source, test.argument)
			if got := slices.Contains(titles, "Run it with try"); got != test.try {
				t.Errorf("Run it with try offered: %v, want %v; titles %q", got, test.try, titles)
			}
			if test.explicit && !slices.Contains(titles, keepInferredEffectTitle) {
				t.Errorf("missing %q; titles %q", keepInferredEffectTitle, titles)
			}
		})
	}
}
