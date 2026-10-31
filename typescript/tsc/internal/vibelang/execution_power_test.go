package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestExecutionPowerQuickFix(t *testing.T) {
	for _, op := range []string{"try", "fork", "join"} {
		for _, operand := range []string{"value", "make()", "holder.value"} {
			t.Run(op+"/"+operand, func(t *testing.T) {
				source := "effect function run() { return " + op + " " + operand + " ** 2 }"
				got := applyExecutionPowerFix(t, source, EK0510.Code, diagnostics.CategoryError)
				want := "effect function run() { return (" + op + " " + operand + ") ** 2 }"
				if got != want {
					t.Fatalf("got %q, want %q", got, want)
				}
			})
		}
	}
}

func applyExecutionPowerFix(t *testing.T, source string, code int32, category diagnostics.Category) string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Source() == diagnosticSource && d.Code() == code {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing EK%d in:\n%s", code, source)
	}
	if diagnostic.Category() != category {
		t.Fatalf("EK%d is %v, want %v", code, diagnostic.Category(), category)
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
			if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Parenthesize ") {
				chosen = action.CodeAction
			}
		}
	}
	if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
		t.Fatalf("no quick fix for EK%d", code)
	}
	changes := *chosen.Edit.Changes
	if len(changes) != 1 {
		t.Fatalf("the fix edits other documents: %v", changes)
	}
	return applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
}

// The CLI uses fileFixes; an editor action alone does not prove --fix sees a
// parser-owned diagnostic. Typed operands keep the corrected program valid.
func TestExecutionPowerCLIFix(t *testing.T) {
	for _, test := range []struct{ op, parameter, operand string }{
		{"try", "value: Effect.Effect<number>", "value"},
		{"join", "fiber: Fiber.Fiber<number>", "fiber"},
	} {
		t.Run(test.op, func(t *testing.T) {
			source := "export effect function run(" + test.parameter + ") { return " + test.op + " " + test.operand + " ** 2 }"
			program, file, _, _ := editorProgram(t, source)
			proposal := fileFixes(t.Context(), program, file, map[string]bool{}, []int32{EK0510.Code})
			want := "export effect function run(" + test.parameter + ") { return (" + test.op + " " + test.operand + ") ** 2 }"
			if got := proposal.text(); got != want {
				t.Fatalf("CLI proposal got %q, want %q", got, want)
			}
		})
	}
}
