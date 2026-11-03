package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// These programs used the old global's signature without storing the
// forbidden hatch binding: the value came from the explicit runtime API.
func TestFixLegacyHatchTypes(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"sync value", "const run: typeof sync = R[\"sync\"]; export const value = run(7)"},
		{"sync type alias", "type Run = typeof sync; const run: Run = R[\"sync\"]; export const value = run(7)"},
		{"sync parameter", "export function use(run: typeof sync) { return run(7) }"},
		{"sync property", "const box: { run: typeof sync } = { run: R[\"sync\"] }; export const value = box.run(7)"},
		{"callback", "const run: typeof callback = R[\"callback\"]; export const value = run<number>((resume) => resume(7))"},
		{"sync factory", "function factory(): typeof sync { return R[\"sync\"] }; const run = factory(); export const value = run(7)"},
		{"callback factory", "function factory(): typeof callback { return R[\"callback\"] }; const run = factory(); export const value = run<number>((resume) => resume(7))"},
		{"sync arrow factory", "const factory = (): typeof sync => R[\"sync\"]; const run = factory(); export const value = run(7)"},
		{"callback arrow factory", "const factory = (): typeof callback => R[\"callback\"]; const run = factory(); export const value = run<number>((resume) => resume(7))"},
		{"callback return only", "export function factory(): typeof callback { return R[\"callback\"] }"},
		{"comments", "const run: typeof /* keep */ sync = R[\"sync\"]; export const value = run(7)"},
		{"instantiation", "type Run = typeof sync<number, [number]>; const run: Run = R[\"sync\"]; export const value = run((n) => n + 1, 7)"},
	} {
		for _, mode := range []struct {
			name    string
			options FixOptions
		}{
			{"default", FixOptions{}}, {"migration", FixOptions{MigrationOnly: true}}, {"vip", FixOptions{VIPOnly: true}},
		} {
			t.Run(test.name+"/"+mode.name, func(t *testing.T) {
				source := "import * as R from \"vibelang-runtime\"\n" + test.source + "\n"
				p, file, _, _ := editorProgram(t, source)
				if len(errorsOf(t, source)) == 0 {
					t.Fatal("regression does not exercise a native type error")
				}
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), mode.options)
				if result.Err != nil {
					t.Fatal(result.Err)
				}
				fixed := result.Files[file.FileName()]
				if fixed == nil {
					t.Fatalf("no preserving rewrite: %+v", result.Refused)
				}
				if !strings.Contains(fixed.Text, "import(\"vibelang-runtime\").") {
					t.Fatal(fixed.Text)
				}
				if strings.Contains(source, "/* keep */") && !strings.Contains(fixed.Text, "/* keep */") {
					t.Fatal("lost type-query comment")
				}
				if ds := errorsOf(t, fixed.Text); len(ds) != 0 {
					t.Fatalf("fixed source: %v\n%s", ds, fixed.Text)
				}
			})
		}
	}
}

func TestFixLegacyHatchTypesLeavesNativeQueries(t *testing.T) {
	for _, source := range []string{
		"const run: typeof sync = sync; export const value = run(() => 7)",
		"import { sync } from \"effect/Effect\"; const run: typeof sync = sync; export const value = run(7)",
		"const sync = (n: number) => n; const run: typeof sync = sync; export const value = run(7)",
		"const run: typeof sync = sync; export const value: string = 7",
	} {
		p, file, _, _ := editorProgram(t, source)
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{VIPOnly: true})
		if fixed := result.Files[file.FileName()]; fixed != nil && strings.Contains(fixed.Text, "import(\"vibelang-runtime\").") {
			t.Fatalf("rewrote a native/shadowed/unrelated query:\n%s", fixed.Text)
		}
	}
}

func TestLegacyHatchTypeEditorAction(t *testing.T) {
	assertLegacyHatchTypeEditorAction(t, "import * as R from \"vibelang-runtime\"\nconst run: typeof /* 😃 */ sync = R[\"sync\"]; export const value = run(7)\n", 2345, "typeof /* 😃 */ sync", "typeof /* 😃 */ import(\"vibelang-runtime\").sync")
}

func TestLegacyHatchTypeFactoryEditorAction(t *testing.T) {
	assertLegacyHatchTypeEditorAction(t, "import * as R from \"vibelang-runtime\"\nexport function factory(): typeof /* 😃 */ callback { return R[\"callback\"] }\n", 2322, "typeof /* 😃 */ callback", "typeof /* 😃 */ import(\"vibelang-runtime\").callback")
}

func assertLegacyHatchTypeEditorAction(t *testing.T, source string, code int32, query, replacement string) {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	for _, item := range program.GetSemanticDiagnostics(t.Context(), file) {
		if item.Code() != code {
			continue
		}
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, item)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray == nil {
			continue
		}
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction == nil || action.CodeAction.Title != legacyHatchTypeAction {
				continue
			}
			edits := (*action.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
			fixed := applyEditorEdits(t, file, converters, edits)
			want := strings.Replace(source, query, replacement, 1)
			if fixed != want {
				t.Fatalf("editor wrote:\n%s\nwant:\n%s", fixed, want)
			}
			if ds := errorsOf(t, fixed); len(ds) != 0 {
				t.Fatal(ds)
			}
			return
		}
	}
	t.Fatal("native argument error has no preserving editor action")
}
