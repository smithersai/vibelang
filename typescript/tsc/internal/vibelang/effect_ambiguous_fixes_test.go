package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestAmbiguousEffectImportQuickFixes(t *testing.T) {
	for _, test := range []struct {
		name     string
		packages []string
	}{
		{"Model", []string{"effect/ai", "effect/schema"}},
		{"Prompt", []string{"effect/ai", "effect/cli"}},
		{"Utils", []string{"effect", "effect/rpc"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "// café 😀\nexport const value = " + test.name + "\n"
			program, file, service, converters := editorProgram(t, source)
			items := program.GetSemanticDiagnostics(t.Context(), file)
			if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != 1401 {
				t.Fatalf("want EK1401, got %v", items)
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, items[0])
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			for _, pkg := range test.packages {
				title := fmt.Sprintf("Import %s from %q", test.name, pkg)
				found := false
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						chosen := action.CodeAction
						if chosen == nil || chosen.Title != title {
							continue
						}
						found = true
						if chosen.Edit == nil || chosen.Edit.Changes == nil {
							t.Fatal("missing edit")
						}
						got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
						if want := fmt.Sprintf("import { %s } from %q\n", test.name, pkg) + source; got != want {
							t.Fatalf("got %q, want %q", got, want)
						}
						checked, edited, _, _ := editorProgram(t, got)
						for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
							if after.Category() == diagnostics.CategoryError {
								t.Errorf("quick fix left %s", after.String())
							}
						}
					}
				}
				if !found {
					t.Errorf("missing %s", title)
				}
			}
		})
	}
}

func TestFixAmbiguousRootPreservesMeaning(t *testing.T) {
	source := "#!/usr/bin/env node\nexport const value = Utils\n"
	_, file, _, _ := editorProgram(t, source)
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	fixed := result.Files[file.FileName()]
	want := strings.Replace(source, "\n", "\nimport { Utils } from \"effect\"\n", 1)
	if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
		t.Fatalf("fixed=%+v refused=%+v", fixed, result.Refused)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	if again := FixProject(t.Context(), fs, bundled.LibPath(), config); len(again.Order) != 0 {
		t.Fatalf("second --fix changed %v", again.Order)
	}
}
