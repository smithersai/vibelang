package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// EK0401's quick fixes (DESIGN.md, nothrow): make the plain code effect code,
// first, then the same with die for a throw statement. The first fix leaves
// a document without errors; code that can't be effect code gets no fix.
func TestThrowOutsideEffectCodeFixes(t *testing.T) {
	for _, test := range []struct{ name, source, titles, title, want string }{
		{
			"callback whose parameter wants a value",
			"export function run(f: () => number) { return f() }\nexport const v = run(() => { throw \"x\" })",
			"",
			"",
			"",
		},
		{
			"callback whose parameter ignores its result",
			"export function run(f: () => void) { f() }\nexport const v = run(() => { throw \"x\" })",
			"Make this function an effect function|Make this function an effect function and fail with a defect: die",
			"Make this function an effect function",
			"export function run(f: () => void) { f() }\nexport const v = run(effect () => { throw \"x\" })",
		},
		{
			"declaration",
			"error Bad\nexport function f(x: number): number {\n  if (x < 0) throw new Bad()\n  return x\n}",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function",
			"error Bad\nexport effect function f(x: number) {\n  if (x < 0) throw new Bad()\n  return x\n}",
		},
		{
			"die",
			"error Bad\nexport function f(x: number): number {\n  if (x < 0) throw new Bad()\n  return x\n}",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function and fail with a defect: die",
			"error Bad\nexport effect function f(x: number) {\n  if (x < 0) return try die(new Bad())\n  return x\n}",
		},
		{
			"die keeps same-line separator",
			"error Bad\nexport function f(x: number): number { if (x < 0) throw new Bad(); return x }",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function and fail with a defect: die",
			"error Bad\nexport effect function f(x: number) { if (x < 0) return try die(new Bad()); return x }",
		},
		{
			"die keeps comment and separator",
			"error Bad\nexport function f(x: number): number { if (x < 0) throw new Bad() /* keep */; return x }",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function and fail with a defect: die",
			"error Bad\nexport effect function f(x: number) { if (x < 0) return try die(new Bad()) /* keep */; return x }",
		},
		{
			"die keeps empty statements",
			"error Bad\nexport function f(x: number): number { if (x < 0) throw new Bad();; return x }",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function and fail with a defect: die",
			"error Bad\nexport effect function f(x: number) { if (x < 0) return try die(new Bad());; return x }",
		},
		{
			"die keeps else separator",
			"error Bad\nexport function f(x: number): number { if (x < 0) throw new Bad(); else return x }",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function and fail with a defect: die",
			"error Bad\nexport effect function f(x: number) { if (x < 0) return try die(new Bad()); else return x }",
		},
		{
			"die keeps block separator",
			"error Bad\nexport function f(x: number): number { if (x < 0) { throw new Bad(); } return x }",
			"Make f an effect function|Make f an effect function and fail with a defect: die",
			"Make f an effect function and fail with a defect: die",
			"error Bad\nexport effect function f(x: number) { if (x < 0) { return try die(new Bad()); } return x }",
		},
		{
			"arrow",
			"error Bad\nexport const g = (x: number): number => { if (x < 0) throw new Bad(); return x }",
			"Make g an effect function|Make g an effect function and fail with a defect: die",
			"Make g an effect function",
			"error Bad\nexport const g = effect (x: number) => { if (x < 0) throw new Bad(); return x }",
		},
		{
			"method",
			"error Bad\nexport class C {\n  static read(x: number): number { if (x < 0) throw new Bad(); return x }\n}",
			"Make read an effect function|Make read an effect function and fail with a defect: die",
			"Make read an effect function",
			"error Bad\nexport class C {\n  static effect read(x: number) { if (x < 0) throw new Bad(); return x }\n}",
		},
		{
			"throw expression",
			"error Missing\nexport const first = (xs: ReadonlyArray<string>): string => xs[0] ?? throw new Missing()",
			"Make first an effect function",
			"Make first an effect function",
			"error Missing\nexport const first = effect (xs: ReadonlyArray<string>) => xs[0] ?? throw new Missing()",
		},
		{
			"known-throwing call",
			"export function p(s: string): unknown {\n  return JSON.parse(s)\n}",
			"Make p an effect function",
			"Make p an effect function",
			"export effect function p(s: string) {\n  return try Effect.try(() => JSON.parse(s))\n}",
		},
		{
			"plain handler",
			"effect function load(): number!string { throw \"x\" }\nexport effect function f() { return try (load() catch (e) => { throw e }) }",
			"Make the handler an effect handler: catch effect|Make the handler an effect handler: catch effect and fail with a defect: die",
			"Make the handler an effect handler: catch effect",
			"effect function load(): number!string { throw \"x\" }\nexport effect function f() { return try (load() catch effect (e) => { throw e }) }",
		},
		{"constructor", "error Bad\nexport class P {\n  constructor(readonly v: number) { if (v < 0) throw new Bad() }\n}", "", "", ""},
		{"getter", "error Bad\nexport class P {\n  get v(): number { throw new Bad() }\n}", "", "", ""},
		{"plain generator", "error Bad\nexport function* g(): Generator<number> { throw new Bad() }", "", "", ""},
		{"top level", "declare const n: number\nif (n < 0) throw new Error(\"n\")", "", "", ""},
		// making these effect would change a type something else fixes
		{"overload implementation", "error Bad\nfunction choose(mode: true): number\nfunction choose(mode: false): number\nfunction choose(mode: boolean): number { throw new Bad() }\nexport const n = choose(true)", "", "", ""},
		{"implemented method", "error Bad\ninterface Reader { read(): string }\nexport class R implements Reader { read(): string { throw new Bad() } }", "", "", ""},
		{"overriding method", "error Bad\nclass Base { read(): string { return \"ok\" } }\nexport class Loud extends Base { read(): string { throw new Bad() } }", "", "", ""},
		{"contextual object method", "error Bad\ninterface Reader { read(): string }\nexport const r: Reader = { read(): string { throw new Bad() } }", "", "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK0401.Code {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing EK0401 in %s", test.source)
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
			var chosen *lsproto.CodeAction
			var titles []string
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.Contains(action.CodeAction.Title, "effect") {
						titles = append(titles, action.CodeAction.Title)
						if action.CodeAction.Title == test.title {
							chosen = action.CodeAction
						}
					}
				}
			}
			if got := strings.Join(titles, "|"); got != test.titles {
				t.Fatalf("EK0401 fixes, in order:\n%s\nwant:\n%s", got, test.titles)
			}
			if test.title == "" {
				return
			}
			if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatalf("missing quick fix %q among %q", test.title, titles)
			}
			edits := (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
			got := applyEditorEdits(t, file, converters, edits)
			if got != test.want {
				t.Fatalf("edited source differs:\ngot: %s\nwant: %s", got, test.want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			for _, after := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
				if after.Category() == diagnostics.CategoryError {
					t.Errorf("quick fix left an error: %s", after.String())
				}
			}
		})
	}
}
