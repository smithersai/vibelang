package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

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
