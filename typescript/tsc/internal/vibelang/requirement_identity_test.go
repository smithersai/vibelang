package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func requirementIdentityProgram(t *testing.T, source string, dependencies map[string]string) (*compiler.Program, *ast.SourceFile, *ls.LanguageService, *lsconv.Converters) {
	t.Helper()
	program, file, _, converters := editorProgram(t, source)
	for name, text := range dependencies {
		if err := os.WriteFile(filepath.Join(filepath.Dir(string(file.FileName())), name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	program = compiler.NewProgram(compiler.ProgramOptions{Config: program.CommandLine(), Host: program.Host()})
	file = program.GetSourceFile(file.FileName())
	return program, file, ls.NewLanguageService(nil, program, editorTestHost{converters: converters}, string(file.FileName())), converters
}

// VIP-3 migrates the body's inferred requirement, not an unrelated type of
// the same name. VIP-34 requires editor and CLI repairs to preserve types.
func TestRequirementMigrationPreservesIdentity(t *testing.T) {
	deps := map[string]string{
		"dep.vibe":     "export service Input { value: number }\n",
		"other.vibe":   "export service Input { value: number }\n",
		"private.vibe": "service Private { value: number }\nexport const read = effect () => (try Private).value\n",
	}
	for _, test := range []struct{ name, head, body, requirement string }{
		{"alias", `import {Input as Renamed} from "./dep.js";`, `(try Renamed).value`, "Renamed"},
		{"alias-any-collision", `import {Input as Renamed} from "./dep.js"; type Input = any;`, `(try Renamed).value`, "Renamed"},
		{"alias-unknown-collision", `import {Input as Renamed} from "./dep.js"; type Input = unknown;`, `(try Renamed).value`, "Renamed"},
		{"namespace", `import * as D from "./dep.js"; type Input = any;`, `(try D.Input).value`, "D.Input"},
		{"two-services", `import {Input as A} from "./dep.js"; import {Input as B} from "./other.js"; type Input = any;`, `(try A).value + (try B).value`, "(A | B)"},
		{"local", `service Input {value: number}`, `(try Input).value`, "Input"},
		{"generic", ``, `try p`, "R"},
		{"private", `import {read} from "./private.js"; type Private = any;`, `try read()`, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			params, typeParams := "", ""
			if test.name == "generic" {
				params, typeParams = "p: number!never!R", "<R>"
			}
			source := test.head + "\nexport effect function f" + typeParams + "(" + params + "): number!never { return " + test.body + " }\n"
			program, file, service, converters := requirementIdentityProgram(t, source, deps)
			var diagnostic *ast.Diagnostic
			missingRequirement := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4853.Code {
					diagnostic = d
				}
				if d.Code() == EK9202.Code {
					missingRequirement = true
				}
				if d.Category() == diagnostics.CategoryError && d.Code() != EK9202.Code {
					t.Fatalf("unexpected original error: %s", d.String())
				}
			}
			if !missingRequirement {
				t.Fatal("witness does not require a service")
			}
			if test.requirement == "" {
				if diagnostic != nil {
					t.Fatalf("unsafe migration offered for inaccessible requirement: %s", diagnostic.String())
				}
			} else {
				if diagnostic == nil {
					t.Fatal("missing EK4853 migration")
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
				want := strings.Replace(source, "): number!never {", "): number!never!"+test.requirement+" {", 1)
				found := false
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if a := action.CodeAction; a != nil && strings.HasPrefix(a.Title, "Write ") && a.Edit != nil && a.Edit.Changes != nil {
							found = true
							got := applyEditorEdits(t, file, converters, (*a.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
							if got != want {
								t.Errorf("editor changed requirement identity:\ngot  %s\nwant %s", got, want)
							}
							fixed, fixedFile, _, _ := requirementIdentityProgram(t, got, deps)
							for _, d := range fixed.GetSemanticDiagnostics(t.Context(), fixedFile) {
								if d.Category() == diagnostics.CategoryError || d.Code() == EK4853.Code {
									t.Errorf("editor repair: %s", d.String())
								}
							}
						}
					}
				}
				if !found {
					t.Fatal("missing editor action")
				}
			}
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if test.requirement == "" {
				if len(result.Files) != 0 {
					t.Fatalf("CLI rewrote private requirement: %v", result.Files)
				}
				return
			}
			repaired, ok := result.Files[file.FileName()]
			if !ok {
				t.Fatalf("CLI failed to repair requirement: %+v", result)
			}
			want := strings.Replace(source, "): number!never {", "): number!never!"+test.requirement+" {", 1)
			if repaired.Text != want {
				t.Errorf("CLI changed requirement identity:\ngot %s\nwant %s", repaired.Text, want)
			}
		})
	}
}
