package vibelang

import (
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

func TestLocalServiceShapeMigration(t *testing.T) {
	source := "export function f(): number {\n  service S { static readonly key = \"local/S\"; n: number }\n  const value: S.Shape = { n: 1 }\n  return value.n\n}\n"
	program, file, service, converters := editorProgram(t, source)
	items := program.GetSemanticDiagnostics(t.Context(), file)
	if len(items) != 1 || items[0].Code() != 2702 {
		t.Fatalf("want TS2702, got %v", items)
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
	want := strings.ReplaceAll(source, "S.Shape", "import(\"effect/Context\").Service.Shape<typeof S>")
	found := false
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			chosen := action.CodeAction
			if chosen != nil && chosen.Title == "Use Context.Service.Shape for the local service" {
				found = true
				got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
				if got != want {
					t.Fatalf("quick fix got %q, want %q", got, want)
				}
			}
		}
	}
	if !found {
		t.Fatal("missing local service shape quick fix")
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
		t.Fatalf("fixed=%+v refused=%+v", fixed, result.Refused)
	}
	checked, edited, _, _ := editorProgram(t, fixed.Text)
	for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
		if after.Category() == diagnostics.CategoryError {
			t.Errorf("migration left %s", after.String())
		}
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	if again := FixProject(t.Context(), fs, bundled.LibPath(), config); len(again.Order) != 0 {
		t.Fatalf("second --fix changed %v", again.Order)
	}
}

func TestModuleServiceShapeNamespace(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export service Top { static readonly key = \"top\"; n: number }\nexport const top: Top.Shape = { n: 1 }\nnamespace N { export service Nested { static readonly key = \"nested\"; n: number }; const impl: Nested.Shape = { n: 2 } }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Error(d.String())
		}
	}
}

func TestLocalServiceShapeMigrationContextShadow(t *testing.T) {
	source := "namespace Context { export const label = \"local\" }\nexport function f(): number {\n  service S { static readonly key = \"shadow/S\"; n: number }\n  const value: S.Shape = { n: 1 }\n  return value.n\n}\n"
	_, file, _, _ := editorProgram(t, source)
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	fixed := result.Files[file.FileName()]
	want := strings.ReplaceAll(source, "S.Shape", "import(\"effect/Context\").Service.Shape<typeof S>")
	if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
		t.Fatalf("fixed=%+v refused=%+v", fixed, result.Refused)
	}
}

func TestLocalServiceShapeGenericFix(t *testing.T) {
	source := "export function f() {\n service S { static readonly key = \"local/generic\"; n: number }\n const value: S.Shape<number> = { n: 1 }\n return value\n}\n"
	program, file, service, converters := editorProgram(t, source)
	found := false
	for _, item := range program.GetSemanticDiagnostics(t.Context(), file) {
		if item.Code() != 2702 && item.Code() != 2503 {
			continue
		}
		found = true
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, item)
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
				if chosen := action.CodeAction; chosen != nil && chosen.Title == "Use Context.Service.Shape for the local service" {
					t.Fatal("a non-generic Shape replacement cannot preserve these type arguments")
				}
			}
		}
	}
	if !found {
		t.Fatal("missing local service namespace diagnostic")
	}
}

func TestLocalServiceOwnShape(t *testing.T) {
	cases := []struct {
		name, source string
		codes        []int32
	}{
		{"class-self", `export function f(): number { service Local { static readonly key = "own/Local"; value: number; next(): Local.Shape }; const value: Context.Service.Shape<typeof Local> = { value: 9, next() { return this } }; return value.next().value }`, nil},
		{"class-parameter", `export function f(): void { service Local { static readonly key = "own/Local"; take(value: Local.Shape): number } }`, nil},
		{"class-constraint", `export function f(): void { service Local { static readonly key = "own/Local"; take<T extends Local.Shape>(value: T): T } }`, nil},
		{"block", `export function f(): void { { service Local { static readonly key = "own/Local"; next?: Local.Shape } } }`, nil},
		{"effect", `export effect function f() { service Local { static readonly key = "own/Local"; next?: Local.Shape }; return 1 }`, nil},
		{"method", `export class Holder { f(): void { service Local { static readonly key = "own/Local"; next?: Local.Shape } } }`, nil},
		{"reference", `export function f(): number { service Flags { static readonly key = "own/Flags"; static readonly defaultValue = () => ({ value: 11, next() { return this } }); value: number; next(): Flags.Shape }; return Context.get(Context.empty(), Flags).next().value }`, nil},
		{"outside", `export function f(): void { service Local { static readonly key = "own/Local"; next?: Local.Shape }; type Outside = Local.Shape }`, []int32{2702}},
		{"sibling", `export function f(): void { service Local { static readonly key = "own/Local"; next?: Local.Shape }; service Other { static readonly key = "own/Other"; next?: Local.Shape } }`, []int32{2702}},
		{"initializer", `export function f(): void { service Flags { static readonly key = "own/Flags"; static readonly defaultValue = (): Flags.Shape => ({value: 1}); value: number } }`, []int32{2702}},
		{"shadow", `export function f(): void { service Local { static readonly key = "own/Local"; take<Local>(value: Local.Shape): number } }`, []int32{2702}},
		{"shadow-return", `export function f(): void { service Local { static readonly key = "own/Local"; take<Local>(): Local.Shape } }`, []int32{2702}},
		{"shadow-property", `export function f(): void { service Local { static readonly key = "own/Local"; take: <Local>(value: Local.Shape) => number } }`, []int32{2702}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			same := len(got) == len(tc.codes)
			for i := range tc.codes {
				same = same && i < len(got) && got[i] == tc.codes[i]
			}
			if !same {
				t.Fatalf("want %v, got %v: %v", tc.codes, got, program.GetSemanticDiagnostics(t.Context(), file))
			}
			if len(tc.codes) == 0 {
				proposal := localServiceShapeMigrationFixes(t.Context(), program, file, map[string]bool{})
				if len(proposal.fixes) != 0 {
					t.Fatalf("valid own member hook was rewritten: %+v", proposal.fixes)
				}
			}
		})
	}
}

// TS2702 can name a shadowing type instead of the outer service. A local
// service migration must follow the same type binding as the checker.
func TestLocalServiceShapeShadowedTypes(t *testing.T) {
	for _, source := range []string{
		"export function scope(): void { service Local { static readonly key = \"shadow/Local\"; n: number }; type Box<Local> = { value: Local.Shape } }",
		"export function scope(): void { service Local { static readonly key = \"shadow/Local\"; n: number }; function nested<Local>(): void { let value: Local.Shape } }",
		"export function scope(): void { service Local { static readonly key = \"shadow/Local\"; n: number }; function nested(): void { type Local = number; let value: Local.Shape } }",
		"export function scope(): void { service Local { static readonly key = \"shadow/Local\"; n: number }; function nested(): void { interface Local { n: number }; let value: Local.Shape } }",
	} {
		program, file, _, _ := editorProgram(t, source)
		var codes []int32
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		if len(codes) != 1 || codes[0] != 2702 {
			t.Fatalf("want [2702], got %v in %s", codes, source)
		}
		proposal := localServiceShapeMigrationFixes(t.Context(), program, file, map[string]bool{})
		if len(proposal.fixes) != 0 {
			t.Fatalf("rewrote a shadowing type as the service: %+v", proposal.fixes)
		}
	}
}
