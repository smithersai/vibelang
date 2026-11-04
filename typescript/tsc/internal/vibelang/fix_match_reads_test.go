package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// RC-16, effectscript-75: a literal type does not make a read inert.
func TestMatchOperandReadRefusals(t *testing.T) {
	for _, test := range []struct{ name, setup, operand string }{
		{"getter", "const holder = { get ready(): 2 { return 2 } };", "holder.ready"},
		{"data property", "const holder = { ready: 2 as const };", "holder.ready"},
		{"let", "let ready: 2 = 2;", "ready"},
		{"computed const", "const ready: 2 = ((): 2 => 2)();", "ready"},
		{"const alias", "const first = 2; const ready = first;", "ready"},
		{"nested getter", "const holder = { get ready(): 2 { return 2 } };", "{ ready: holder.ready }"},
		{"parameter", "", "ready"},
		{"ambient const", "declare const ready: 2;", "ready"},
		{"ambient initializer", "declare const ready = 2;", "ready"},
		{"shadowed undefined", "const undefined: 2 = ((): 2 => 2)();", "undefined"},
	} {
		for _, builder := range []string{"value", "type"} {
			t.Run(test.name+"/"+builder, func(t *testing.T) {
				start := "Match.value(n)"
				if builder == "type" {
					start = "Match.type<number>()"
				}
				source := test.setup + "\nexport function choose(n: number, ready: 2): string { return " + start + ".pipe(Match.when(" + test.operand + ", (): string => 'hit'), Match.orElse((): string => 'miss'))"
				if builder == "type" {
					source += "(n)"
				}
				source += " }\n"
				if test.name == "nested getter" {
					source = strings.ReplaceAll(source, "n: number", "n: { ready: number }")
					source = strings.ReplaceAll(source, "Match.type<number>()", "Match.type<{ ready: number }>()")
				}
				// Avoid a parameter hiding the binding under test.
				if test.name != "parameter" {
					source = strings.ReplaceAll(source, "n: number, ready: 2", "n: number")
				}
				program, file, service, converters := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid fixture: %s%d: %s\n%s", d.Source(), d.Code(), d.String(), source)
					}
					if d.Source() != diagnosticSource || d.Code() != EK4839.Code {
						continue
					}
					found = true
					notes := ""
					for _, n := range d.MessageChain() {
						notes += n.String()
					}
					if !strings.Contains(notes, "No quick fix") {
						t.Errorf("missing refusal: %s", notes)
					}
					diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
						Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}},
					})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray != nil {
						for _, action := range *response.CommandOrCodeActionArray {
							if action.CodeAction != nil && action.CodeAction.Title == "Write a match expression" {
								t.Errorf("unsafe Match repair offered: %s", action.CodeAction.Title)
							}
						}
					}
				}
				if !found {
					t.Fatal("missing EK4839 advisory")
				}
			})
		}
	}
}

func TestMatchInertLiteralBindings(t *testing.T) {
	for _, setup := range []string{
		"const ready = 2;",
		"const ready = -2;",
		"const ready = 'ready';",
		"const ready = true;",
	} {
		source := "export function choose(n: number | string | boolean | null): string { " + setup + " return Match.value(n).pipe(Match.when(ready, (): string => 'hit'), Match.orElse((): string => 'miss')) }\n"
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Match.when") {
			t.Fatalf("inert literal not repaired:\n%s", fixed)
		}
	}
}

// Imported values can still be in TDZ through a cycle, even if their source
// has a literal initializer; keep all such reads eager.
func TestMatchImportedLiteralBindings(t *testing.T) {
	for _, test := range []struct {
		name, imported, operand string
		offered                 bool
	}{
		{"aliased literal", "{ importedReady as ready } from 'operand-fixture/constants'", "ready", false},
		{"re-exported literal", "{ forwardedReady as ready } from 'operand-fixture/forwarded'", "ready", false},
		{"computed const", "{ computedReady as ready } from 'operand-fixture/constants'", "ready", false},
		{"let", "{ mutableReady as ready } from 'operand-fixture/constants'", "ready", false},
		{"declaration literal", "{ declaredReady as ready } from 'operand-fixture/declared'", "ready", false},
		{"namespace property", "* as constants from 'operand-fixture/constants'", "constants.importedReady", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import " + test.imported + ";\nexport function choose(n: number): string { return Match.value(n).pipe(Match.when(" + test.operand + ", (): string => 'hit'), Match.orElse((): string => 'miss')) }\n"
			program, file, service, converters := editorProgramWith(t, source, map[string]string{
				"effect":           "packages/runtime/node_modules/effect",
				"vibelang-runtime": "packages/runtime",
				"operand-fixture":  "typescript/vibelang/cases/match-operand-reads",
			})
			found, offered := false, false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid fixture: %s%d: %s\n%s", d.Source(), d.Code(), d.String(), source)
				}
				if d.Source() != diagnosticSource || d.Code() != EK4839.Code {
					continue
				}
				found = true
				diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && action.CodeAction.Title == "Write a match expression" {
							offered = true
						}
					}
				}
			}
			if !found {
				t.Fatal("missing EK4839 advisory")
			}
			if offered != test.offered {
				t.Errorf("Match quick fix offered = %v, want %v", offered, test.offered)
			}
		})
	}
}

// RC-16: textual declaration order alone cannot establish initialization
// across a function activation, a class initializer, or a module cycle.
func TestMatchLiteralBindingInitializationRefusals(t *testing.T) {
	for _, source := range []string{
		"const ready=2; export function f(n:number):string { return Match.value(n).pipe(Match.when(ready,():string=>'hit'),Match.orElse(():string=>'miss')) }",
		"export function f(n:number):string { return Match.value(n).pipe(Match.when(1,():string=>'first'),Match.when(ready,():string=>'hit'),Match.orElse(():string=>'miss')) }; const ready=2;",
		"export function f(n:number):string { class C { value:string=Match.value(n).pipe(Match.when(ready,():string=>'hit'),Match.orElse(():string=>'miss')) }; const ready=2; return new C().value }",
	} {
		p, f, _, _ := editorProgram(t, source)
		found := false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if d.Source() != diagnosticSource || d.Code() != EK4839.Code {
				continue
			}
			for _, note := range d.MessageChain() {
				if strings.Contains(note.String(), "No quick fix") {
					found = true
				}
			}
		}
		if !found {
			t.Fatalf("missing initialization refusal: %s", source)
		}
	}
}
