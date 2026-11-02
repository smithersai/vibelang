package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// D282: a throw that can escape a function with a plain return annotation is
// EK9203, and its quick fix writes the Effect contract that names the
// failures. The fixed document type-checks.
func TestPlainContractFailureFix(t *testing.T) {
	for _, test := range []struct{ name, source, title, want string }{
		{
			"arrow",
			"error Invalid { value: string }\nexport const validate = (value: string): string => {\n  if (value === \"\") throw new Invalid({ value })\n  return value\n}",
			"Write string!Invalid!",
			"error Invalid { value: string }\nexport const validate = (value: string): string!Invalid! => {\n  if (value === \"\") throw new Invalid({ value })\n  return value\n}",
		},
		{
			"match arm",
			"error Invalid { value: string }\nexport function pick(tag: string): number {\n  return match (tag) {\n    when \"a\": 1;\n    default: throw new Invalid({ value: tag });\n  }\n}",
			"Write number!Invalid!",
			"error Invalid { value: string }\nexport function pick(tag: string): number!Invalid! {\n  return match (tag) {\n    when \"a\": 1;\n    default: throw new Invalid({ value: tag });\n  }\n}",
		},
		{
			"two failures",
			"error Invalid { value: string }\nerror Missing\nexport function check(value: string | undefined): string {\n  if (value === undefined) throw new Missing()\n  if (value === \"\") throw new Invalid({ value })\n  return value\n}",
			"Write string!Invalid | Missing!",
			"error Invalid { value: string }\nerror Missing\nexport function check(value: string | undefined): string!Invalid | Missing! {\n  if (value === undefined) throw new Missing()\n  if (value === \"\") throw new Invalid({ value })\n  return value\n}",
		},
		{
			"runs an Effect",
			"export function greet(name: string): number {\n  Console.log(name)\n  return name.length\n}",
			"Write number!!",
			"export function greet(name: string): number!! {\n  Console.log(name)\n  return name.length\n}",
		},
		{
			"needs a service",
			"service Count { value: number }\nexport function read(): number {\n  return Count().value\n}",
			"Write number!!Count",
			"service Count { value: number }\nexport function read(): number!!Count {\n  return Count().value\n}",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK9203.Code {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing EK9203 in %s", test.source)
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
					if action.CodeAction != nil {
						titles = append(titles, action.CodeAction.Title)
						if action.CodeAction.Title == test.title {
							chosen = action.CodeAction
						}
					}
				}
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

// A plain annotation on a function that cannot fail offers no contract fix.
func TestPlainContractWithoutFailureHasNoFix(t *testing.T) {
	program, file, _, _ := editorProgram(t, "error Invalid { value: string }\nexport const clamp = (n: number): number => {\n  try {\n    if (n > 10) throw new Invalid({ value: String(n) })\n    return n\n  } catch (e) {\n    return e.value.length\n  }\n}")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("a plain function whose catch handles its throw: %s", d.String())
		}
	}
}

// EK9203 leads with what the plain function can't do and names the function
// and what it throws or runs, then says why: its return annotation. Its notes
// give every way out as code, the Effect contract first.
func TestPlainContractMessages(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{
			"throw",
			"export function knownTags(ok: boolean): ReadonlySet<string> {\n  if (!ok) throw new Error(\"bad\")\n  return new Set([\"a\"])\n}",
			"knownTags can't throw Error: its return annotation, ReadonlySet<string>, makes it a plain function, which never fails.\n" +
				"Make it an Effect function: ReadonlySet<string>!Error!\n" +
				"Or fail with a defect instead: die(new Error(\"bad\")), annotated ReadonlySet<string>!!\n" +
				"Or escape to TypeScript: move knownTags to a .ts file or a module block, or wrap the throw in sync(() => { … }), annotated ReadonlySet<string>!!",
		},
		{
			"throw expression",
			"error Missing\nexport const first = (xs: ReadonlyArray<string>): string => xs[0] ?? throw new Missing()",
			"first can't throw Missing: its return annotation, string, makes it a plain function, which never fails.\n" +
				"Make it an Effect function: string!Missing!\n" +
				"Or fail with a defect instead: die(new Missing()), annotated string!!\n" +
				"Or escape to TypeScript: move first to a .ts file or a module block, or wrap the throw in sync(() => { … }), annotated string!!",
		},
		{
			"failing call",
			"error Missing\nexport function find(ok: boolean): number!Missing! {\n  if (!ok) throw new Missing()\n  return 1\n}\nexport function count(): number {\n  return find(true)\n}",
			"count can't run find(true), an Effect that can fail with Missing: its return annotation, number, makes it a plain function, which runs no Effects.\n" +
				"Make it an Effect function: number!Missing!\n" +
				"Or remove the annotation to infer the whole contract.",
		},
		{
			"service",
			"service Count { value: number }\nexport function read(): number {\n  return Count().value\n}",
			"read can't run Count(), an Effect: its return annotation, number, makes it a plain function, which runs no Effects.\n" +
				"Make it an Effect function: number!!Count\n" +
				"Or remove the annotation to infer the whole contract.",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var got []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK9203.Code {
					got = append(got, diagnosticWithNotes(d))
				}
			}
			if len(got) != 1 || got[0] != test.want {
				t.Fatalf("EK9203 messages:\n%s\nwant:\n%s", strings.Join(got, "\n---\n"), test.want)
			}
		})
	}
}
