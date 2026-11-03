package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestSchemaTypeParameterCompilerDiagnostic(t *testing.T) {
	for _, source := range []string{"schema User<T> {name:string}", "schema User<T> = string"} {
		program, file, _, _ := editorProgram(t, source)
		ds := program.GetSyntacticDiagnostics(t.Context(), file)
		if len(ds) == 0 {
			ds = program.GetSemanticDiagnostics(t.Context(), file)
		}
		var codes []string
		for _, d := range ds {
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			codes = append(codes, fmt.Sprintf("%s%04d: %s", prefix, d.Code(), d.String()))
		}
		if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1502 {
			t.Errorf("want only EK1502 for %s; got %v", source, codes)
		}
	}
}

func TestSchemaTypeParameterPreservingQuickFix(t *testing.T) {
	for _, source := range []string{
		"type T = {name:number}; const string = 1; export schema User<T> {name:string}; export const empty:User = {}",
		"const value = 1; export schema User<number>value; export const empty:User = {}",
		"export schema User\n<T>(value:T) => value; export const empty:User = {}",
	} {
		t.Run(source, func(t *testing.T) {
			source = "// café 😀\n" + source
			want := strings.Replace(source, "<", " {}; <", 1)
			got := schemaTypeParameterQuickFix(t, source)
			if got != want {
				t.Fatalf("want preserving edit %q; got %q", want, got)
			}
			program, file, _, _ := editorProgram(t, got)
			ds := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			if len(ds) != 0 {
				t.Fatalf("repair leaves errors: %v", ds)
			}
		})
	}
}

func TestSchemaTypeParameterPreservingProjectFix(t *testing.T) {
	source := "type T = {name:number}; const string = 1; export schema User<T> {name:string}; export const empty:User = {}"
	result, name, _ := fixOnce(t, source)
	fixed := result.Files[name]
	if len(result.Refused) != 0 || fixed == nil {
		t.Fatalf("missing preserving --fix: files=%v refused=%v", result.Files, result.Refused)
	}
	want := strings.Replace(source, "<", " {}; <", 1)
	if fixed.Text != want {
		t.Fatalf("want %q, got %q", want, fixed.Text)
	}
	again, _, _ := fixOnce(t, fixed.Text)
	if len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("not idempotent: files=%v refused=%v", again.Files, again.Refused)
	}
}

// This diagnostic is syntactic; the general ts-form helper reads semantic warnings.
func schemaTypeParameterQuickFix(t *testing.T, source string) string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 1502 {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing syntactic EK1502 in %q", source)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction != nil && action.CodeAction.Title == "Keep the previous empty schema and TypeScript expression" &&
				action.CodeAction.Edit != nil && action.CodeAction.Edit.Changes != nil {
				changes := *action.CodeAction.Edit.Changes
				if len(changes) != 1 {
					t.Fatalf("fix edits other files: %v", changes)
				}
				return applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
			}
		}
	}
	t.Fatal("missing syntactic schema parameter repair")
	return ""
}
