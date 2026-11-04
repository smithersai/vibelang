package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestDeclarationBodyQuickFixSelectsDiagnostic(t *testing.T) {
	for _, source := range []string{
		"schema A\nschema B\n",
		"const data=1;type T=number;\ndata as T;\nschema A\n",
		"const data=1;type T=number;\ndata\nas T;\nschema A\n",
	} {
		t.Run(source, func(t *testing.T) {
			p, f, service, converters := editorProgram(t, source)
			count := 0
			for _, diagnostic := range p.GetSyntacticDiagnostics(t.Context(), f) {
				if diagnostic.Source() != diagnosticSource || (diagnostic.Code() != 1503 && diagnostic.Code() != 1604) {
					continue
				}
				count++
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				uri := lsconv.FileNameToDocumentURI(f.FileName())
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only}})
				if err != nil {
					t.Fatal(err)
				}
				var fixed string
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Preserve the expression") && action.CodeAction.Edit != nil && action.CodeAction.Edit.Changes != nil {
							fixed = applyEditorEdits(t, f, converters, (*action.CodeAction.Edit.Changes)[uri])
						}
					}
				}
				if fixed == "" {
					t.Errorf("no fix for selected EK%d at%d", diagnostic.Code(), diagnostic.Pos())
					continue
				}
				checked, next, _, _ := editorProgram(t, fixed)
				remaining := 0
				for _, after := range checked.GetSyntacticDiagnostics(t.Context(), next) {
					if after.Code() == 1503 || after.Code() == 1604 {
						remaining++
					}
				}
				total := 0
				for _, before := range p.GetSyntacticDiagnostics(t.Context(), f) {
					if before.Code() == 1503 || before.Code() == 1604 {
						total++
					}
				}
				if remaining != total-1 {
					t.Errorf("fix changed wrong headers: %q, remain%d,want%d", fixed, remaining, total-1)
				}
				if strings.Contains(source, "data\nas T") && !strings.Contains(fixed, "data\nas T") {
					t.Errorf("ordinary assertion rewritten: %s", fixed)
				}
				// The chosen repair must cover this diagnostic, not another header.
				if diagnostic.Code() == 1503 {
					name := "A"
					if strings.Contains(source, "schema B") && diagnostic.Pos() > strings.Index(source, "schema B") {
						name = "B"
					}
					if !strings.Contains(fixed, "schema "+name+" {}") {
						t.Errorf("wrong selected header: %s", fixed)
					}
				} else if !strings.Contains(fixed, "(data as T)") {
					t.Errorf("assertion not parenthesized: %s", fixed)
				}
			}
			if count == 0 {
				t.Fatal("test did not find a missing-body diagnostic")
			}
		})
	}
}

func TestDeclarationBodyFixRespectsCodes(t *testing.T) {
	source := "const data=1;type T=number;\nschema A\ndata as T;\n"
	for _, code := range []int32{1503, 1604} {
		p, f, _, _ := editorProgram(t, source)
		proposed := fileFixes(t.Context(), p, f, map[string]bool{}, []int32{code})
		if len(proposed.fixes) != 1 || proposed.fixes[0].code != code {
			t.Fatalf("requestedEK%d: fixes %+v", code, proposed.fixes)
		}
		fixed := proposed.text()
		if code == 1503 && (!strings.Contains(fixed, "schema A {}") || !strings.Contains(fixed, "\ndata as T;")) {
			t.Errorf("schema fix changed data: %s", fixed)
		}
		if code == 1604 && (!strings.Contains(fixed, "(data as T)") || strings.Contains(fixed, "schema A {}")) {
			t.Errorf("data fix changed schema: %s", fixed)
		}
	}
}
