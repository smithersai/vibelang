package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestNestedSchemaAliasesCheckTypes(t *testing.T) {
	source := "namespace Models { export schema Bad = unknown }\nfunction local() { schema Bad = Date; return Bad }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != EK2109.Code {
			t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
		}
		count++
	}
	if count != 2 {
		t.Fatalf("want two EK2109 diagnostics, got %d", count)
	}
}

func TestNestedSchemaAliasKeywordQuickFix(t *testing.T) {
	for _, source := range []string{
		"namespace Models { export schema Value = unknown }\n",
		"function local() { schema Value = unknown; return Value }\n",
	} {
		got := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		want := strings.ReplaceAll(source, "unknown", "Schema.Unknown")
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
}

func TestNestedSchemaAliasKeywordFixPreservesOldCodec(t *testing.T) {
	for _, source := range []string{
		"namespace Models {export schema Value=any}\n",
		"namespace Models {export schema Value=never}\n",
		"namespace Models {export schema Value=object}\n",
		"namespace Models {export schema Value=void}\n",
		"function local():infer _ {schema Value=never;return Value}\n",
		"namespace Models {export schema Value=readonly never[]}\n",
		"namespace Models {export schema Value=number|never}\n",
		"namespace Models {export schema Value=string&number}\n",
		"namespace Models {export schema Value=keyof {name:string}}\n",
	} {
		t.Run(source, func(t *testing.T) {
			got := applyFirstNestedAliasFix(t, source)
			if !strings.Contains(got, "Schema.Unknown") {
				t.Fatalf("lost the old Unknown codec: %q", got)
			}
		})
	}
	for _, pair := range [][2]string{
		{"export schema Value=never\n", "Schema.Never"},
		{"namespace Models {export schema Value {item:any}}\n", "Schema.Any"},
		{"namespace Models {export schema Value={item:any}}\n", "Schema.Any"},
	} {
		t.Run(pair[0], func(t *testing.T) {
			got := applyQuickFixOf(t, pair[0], EK2109.Code, diagnostics.CategoryError)
			if !strings.Contains(got, pair[1]) {
				t.Fatalf("changed an already-checked keyword suggestion: %q", got)
			}
		})
	}
}

func applyFirstNestedAliasFix(t *testing.T, source string) string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
		if diagnostic.Source() != diagnosticSource || diagnostic.Code() != EK2109.Code {
			continue
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
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction == nil {
					continue
				}
				fix := action.CodeAction
				if fix.Title != "Keep the previous Schema.Unknown codec" {
					t.Fatalf("first fix changes the old codec: %s", fix.Title)
				}
				if fix.Edit == nil || fix.Edit.Changes == nil {
					t.Fatal("missing preserving edit")
				}
				changes := *fix.Edit.Changes
				return applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
			}
		}
		t.Fatal("no preserving code action")
	}
	t.Fatalf("missing EK2109 in %s", source)
	return ""
}
