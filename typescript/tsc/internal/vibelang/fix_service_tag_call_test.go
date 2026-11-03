package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const tagCallHead = `import * as Context from "effect/Context"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"

class ClassTag extends Context.Service<ClassTag, { readonly v: number }>()("ClassTag") {}
const Plat = Context.Reference<{ readonly os: string }>("Plat", { defaultValue: () => ({ os: "x" }) })
const make = () => Effect.succeed(1)

`

// The quick fix on TS2349 and TS2348, as an editor and vibelang --fix apply
// it: try <Tag>() becomes try <Tag>, over each tag kind.
func TestServiceTagCallQuickFix(t *testing.T) {
	for _, test := range []struct{ name, call, bare string }{
		{"service member", "FileSystem.FileSystem()", "FileSystem.FileSystem"},
		{"namespace of the same name", "Path()", "Path.Path"},
		{"class tag", "ClassTag()", "ClassTag"},
		{"reference", "Plat()", "Plat"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := "export effect function g() {\n  const s = try %\n  return String(s !== undefined)\n}\n"
			source := tagCallHead + strings.Replace(body, "%", test.call, 1)
			want := tagCallHead + strings.Replace(body, "%", test.bare, 1)
			program, file, service, converters := editorProgram(t, source)
			var chosen *lsproto.CodeAction
			for _, item := range program.GetSemanticDiagnostics(t.Context(), file) {
				if item.Source() != "" || item.Code() != 2349 && item.Code() != 2348 {
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
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && action.CodeAction.Title == "Run the value with try, without calling it" {
							chosen = action.CodeAction
						}
					}
				}
			}
			if chosen == nil {
				t.Fatalf("no quick fix for %s", test.call)
			}
			got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
			if got != want {
				t.Fatalf("the quick fix wrote\n%s\nwant\n%s", got, want)
			}
			if errors := errorsOf(t, got); len(errors) != 0 {
				t.Fatalf("the fixed source reports %v", errors)
			}
		})
	}
}

// A function's call keeps its parentheses, and an untried read of a tag is
// not this fix's: --fix leaves the call and its TS2349 standing.
func TestServiceTagCallFixLeaves(t *testing.T) {
	for _, test := range []struct{ name, body, keep string }{
		{"function returning an Effect", "export effect function g() {\n  return try make()\n}\n", "try make()"},
		{"untried read", "export effect function g() {\n  const s = Plat()\n  return String(s !== undefined)\n}\n", "= Plat()"},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tagCallHead+test.body)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			text := file.Text()
			if fixed := result.Files[file.FileName()]; fixed != nil {
				text = fixed.Text
			}
			if !strings.Contains(text, test.keep) {
				t.Fatalf("--fix removed %q:\n%s", test.keep, text)
			}
		})
	}
}
