package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Chapter 003, Quick fixes: a published export offers the TS move before changing its public return type.
func TestNothrowMoveQuickFix(t *testing.T) {
	for _, tc := range []struct {
		name, source, pkg string
		first             bool
	}{
		{"published function", "export function f(s: string): unknown { return JSON.parse(s) }", editorPackageJSON, true},
		{"private function", "export function f(s: string): unknown { return JSON.parse(s) }", `{"name":"app","private":true,"type":"module"}`, false},
		{"unnamed package", "export function f() { throw 1 }", `{"type":"module"}`, false},
		{"default named function", "export default function f() { throw 1 }", editorPackageJSON, true},
		{"imports", "import { Option, Effect } from \"effect\";\nexport function f(): number { if (Option.isNone(Option.none())) throw 1; return 0 }", editorPackageJSON, true},
		{"arrow", "export const f = (n: number): number => { throw n }", editorPackageJSON, true},
		{"function expression", "export const f = function(n: number): number { throw n }", editorPackageJSON, true},
		{"generator", "export function* f(): Generator<number> { yield 1; throw 2 }", editorPackageJSON, true},
		{"constructor", "export class C { constructor() { throw 1 } }", editorPackageJSON, true},
		{"accessor", "export class C { get value(): number { throw 1 } }", editorPackageJSON, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, service, converters := editorProgramWithPackage(t, tc.source, tc.pkg)
			var diag *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK0401.Code {
					diag = d
					break
				}
			}
			if diag == nil {
				t.Fatalf("missing EK0401: syntax=%v semantic=%v", program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file))
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diag)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(moveModuleContext(t.Context()), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range,
				Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			var titles []string
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil {
						titles = append(titles, a.CodeAction.Title)
						if strings.Contains(a.CodeAction.Title, "to a .ts file") {
							chosen = a.CodeAction
						}
					}
				}
			}
			if chosen == nil {
				t.Fatalf("missing TS move: %v", titles)
			}
			if tc.first && titles[0] != chosen.Title {
				t.Fatalf("published export should prefer TS: %v", titles)
			}
			if !tc.first && titles[0] == chosen.Title {
				t.Fatalf("private/unnamed package should prefer effect: %v", titles)
			}
			if chosen.Edit == nil || chosen.Edit.DocumentChanges == nil {
				t.Fatal("move must atomically create and edit")
			}
			var created lsproto.DocumentUri
			texts := map[lsproto.DocumentUri][]*lsproto.TextEdit{}
			for _, change := range *chosen.Edit.DocumentChanges {
				if change.CreateFile != nil {
					created = change.CreateFile.Uri
					if change.CreateFile.Options != nil && change.CreateFile.Options.Overwrite != nil && *change.CreateFile.Options.Overwrite {
						t.Fatal("must not overwrite")
					}
				}
				if change.TextDocumentEdit != nil {
					for _, edit := range change.TextDocumentEdit.Edits {
						texts[change.TextDocumentEdit.TextDocument.Uri] = append(texts[change.TextDocumentEdit.TextDocument.Uri], edit.TextEdit)
					}
				}
			}
			if created == "" || !strings.HasSuffix(string(created), ".ts") {
				t.Fatalf("new file: %s", created)
			}
			body := texts[created]
			wanted := strings.Replace(tc.source, "default ", "", 1)
			if strings.HasPrefix(wanted, "import ") {
				wanted = wanted[strings.Index(wanted, "export function"):]
			}
			if len(body) != 1 || strings.Contains(body[0].NewText, "@throws") || !strings.Contains(body[0].NewText, wanted) {
				t.Fatalf("must preserve TS source without inventing annotations: %+v", body)
			}
			edited := applyEditorEdits(t, file, converters, texts[lsconv.FileNameToDocumentURI(file.FileName())])
			if !strings.Contains(edited, "import {") || !strings.Contains(edited, "export {") && !strings.Contains(edited, "export const f =") {
				t.Fatalf("missing local binding/re-export: %s", edited)
			}
			// Real files, then the ordinary checker: the move must not leave an unresolved local or a new diagnostic.
			target := strings.TrimPrefix(string(created), "file://")
			if err := os.WriteFile(target, []byte(body[0].NewText), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(edited), 0600); err != nil {
				t.Fatal(err)
			}
			checked := compiler.NewProgram(compiler.ProgramOptions{Config: program.CommandLine(), Host: compiler.NewCompilerHost(program.Host().FS(), bundled.LibPath(), nil, nil, nil)})
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), nil), checked.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("moved source: %s", d.String())
				}
			}
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("recheck: %+v", result)
			}
		})
	}
}

func TestNothrowPreferredAutomaticFix(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		fixed        bool
	}{
		{"plain handler", "effect function load(): number!string { throw \"x\" }\nexport effect function f() { return try (load() catch (e) => { throw e }) }", true},
		{"unused local", "function f() { throw 1 }\nexport const answer = 42", true},
		{"published export", "export function f() { throw 1 }", false},
		{"dynamic use", "function f() { throw 1 }\nexport const answer = eval(\"f()\")", false},
		{"captured shorthand", "function f() { throw 1 }\nexport const stored = { f }", false},
		{"called local", "function f() { throw 1 }\nexport function g() { return f() }", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if tc.fixed && (fixed == nil || !strings.Contains(fixed.Text, "effect")) {
				t.Fatalf("preferred fix not applied: %+v", result)
			}
			if tc.fixed && tc.name == "plain handler" && !strings.Contains(fixed.Text, "catch effect") {
				t.Fatalf("did not make handler effect: %s", fixed.Text)
			}
			if tc.fixed && tc.name == "unused local" && !strings.Contains(fixed.Text, "effect function f") {
				t.Fatalf("did not make unused function effect: %s", fixed.Text)
			}
			if !tc.fixed && fixed != nil {
				t.Fatalf("unsafe change applied: %s", fixed.Text)
			}
		})
	}
}

func TestNothrowMoveDeclinesUnsafeSource(t *testing.T) {
	for _, source := range []string{
		"// noUnusedLocals\nimport { Option } from \"effect\"; export function f() { if (Option.isNone(Option.none())) throw 1 }",
		"export function f(value: string): number; export function f(value: string): number { throw 1 }",
		"export function f(value: string): number; export function f(value: number): number; export function f(value: string | number): number { throw 1 }",
		"export function f(): number { throw 1 }; export namespace f { export const tag = 1 }",
		"export class C { constructor() { throw 1 } } export namespace C { export const extra = 1 }",
		"const secret = 1; export function f() { throw secret }",
		"const secret = 1; export function f() { throw { secret } }",
		"export function f(): number { throw 1 }; f = () => 2",
		"export function f(): number { throw 1 }; ({ f } = { f: () => 2 })",
		"export function f(): number { throw 1 }; const copy: () => number = f",
		"export function f(): number { throw 1 }; export effect function use() { return f() }",
		"export function f() { throw eval('secret') }",
		"export function f() { throw import.meta.url }",
		"export class C { static n = 1; constructor() { throw 1 } }",
		"const before = 1; export class C { constructor() { throw 1 } }",
		"export function f() { const nested = effect () => 1; throw 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			if strings.HasPrefix(source, "// noUnusedLocals") {
				program.Options().NoUnusedLocals = core.TSTrue
			}
			found := false
			for _, diag := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diag.Code() != EK0401.Code {
					continue
				}
				found = true
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diag)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(moveModuleContext(t.Context()), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range,
					Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, a := range *response.CommandOrCodeActionArray {
						if a.CodeAction != nil && strings.Contains(a.CodeAction.Title, "to a .ts file") {
							t.Fatalf("unsafe move offered: %s", a.CodeAction.Title)
						}
					}
				}
				break
			}
			if !found {
				t.Fatal("missing no-throw control diagnostic")
			}
		})
	}
}
