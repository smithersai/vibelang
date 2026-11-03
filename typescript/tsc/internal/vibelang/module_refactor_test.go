package vibelang

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// moveModuleContext is a client that can create files as part of an edit.
func moveModuleContext(ctx context.Context) context.Context {
	caps := &lsproto.ResolvedClientCapabilities{}
	caps.Workspace.WorkspaceEdit.DocumentChanges = true
	caps.Workspace.WorkspaceEdit.ResourceOperations = []lsproto.ResourceOperationKind{lsproto.ResourceOperationKindCreate}
	return lsproto.WithClientCapabilities(ctx, caps)
}

func TestMoveModuleRefactorGoldens(t *testing.T) {
	for _, tc := range []struct{ name, source, want, body, taken, target string }{
		{"imports and exports", "module /*cursor*/parse {\n  /** @throws {RangeError} */\n  export function port(raw: string): number { return Number(raw) }\n  export interface Port { readonly value: number }\n}\nimport parse\nimport { port } from parse\nexport { port } from parse\nexport * as ports from parse\nexport type { Port } from parse\n",
			"import \"./parse.js\"\nimport { port } from \"./parse.js\"\nexport { port } from \"./parse.js\"\nexport * as ports from \"./parse.js\"\nexport type { Port } from \"./parse.js\"\n",
			"/** @throws {RangeError} */\nexport function port(raw: string): number { return Number(raw) }\nexport interface Port { readonly value: number }\n", "", "parse.ts"},
		{"case insensitive collision", "module /*cursor*/Parse { export const n = 1 }\nexport { n } from Parse\n", "export { n } from \"./main.Parse.js\"\n", "export const n = 1\n", "parse.ts", "main.Parse.ts"},
		{"directory collision", "module /*cursor*/parse { export const n = 1 }\nexport { n } from parse\n", "export { n } from \"./main.parse.js\"\n", "export const n = 1\n", "parse/", "main.parse.ts"},
		{"preserve other module", "module other { export const n = 2 }\nmodule /*cursor*/parse { export const n = 1 }\nexport { n } from parse\nexport { n as m } from other\n",
			"module other { export const n = 2 }\nexport { n } from \"./parse.js\"\nexport { n as m } from other\n", "export const n = 1\n", "", "parse.ts"},
		{"body selection", "module parse {\n  export const /*cursor*/n = 1\n}\nexport { n } from parse\n", "export { n } from \"./parse.js\"\n", "export const n = 1\n", "", "parse.ts"},
		{"unexported body", "module /*cursor*/parse { const hidden = 1 }\nimport parse\n", "import \"./parse.js\"\n", "const hidden = 1\nexport {}\n", "", "parse.ts"},
		{"escaped reference", "module /*cursor*/parse { export const n = 1 }\nexport { n } from p\\u0061rse\n", "export { n } from \"./parse.js\"\n", "export const n = 1\n", "", "parse.ts"},
		{"empty module", "module /*cursor*/parse {}\nimport parse\n", "import \"./parse.js\"\n", "export {}\n", "", "parse.ts"},
		{"continued string whitespace", "module /*cursor*/parse {\n  export const text = \"a\\\n    b\"\n}\nexport { text } from parse\n",
			"export { text } from \"./parse.js\"\n", "  export const text = \"a\\\n    b\"\n", "", "parse.ts"},
		{"template whitespace", "module /*cursor*/parse {\n  export const text = `first\n    second\n  `\n}\nexport { text } from parse\n",
			"export { text } from \"./parse.js\"\n", "  export const text = `first\n    second\n  `\n", "", "parse.ts"},
		{"comments and unicode", "// café 😀\nmodule /*cursor*/parse {\n  // keep body\n  export const n = 1\n}\n// keep use\nexport { n } from parse\n",
			"// café 😀\n// keep use\nexport { n } from \"./parse.js\"\n", "// keep body\nexport const n = 1\n", "", "parse.ts"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			offset := strings.Index(tc.source, "/*cursor*/")
			source := strings.Replace(tc.source, "/*cursor*/", "", 1)
			_, file, service, converters := editorProgram(t, source)
			if tc.taken != "" {
				name := filepath.Join(file.FileName().Directory().AsString(), tc.taken)
				if strings.HasSuffix(tc.taken, "/") {
					if err := os.Mkdir(name, 0700); err != nil {
						t.Fatal(err)
					}
				} else if err := os.WriteFile(name, []byte("export {}\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindRefactorRewrite}
			response, err := service.ProvideCodeActions(moveModuleContext(t.Context()), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: lsproto.Range{Start: pos, End: pos},
				Context: &lsproto.CodeActionContext{Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && action.CodeAction.Title == "Move module to a .ts file" {
						chosen = action.CodeAction
					}
				}
			}
			if chosen == nil {
				t.Fatal("missing Move module to a .ts file refactor")
			}
			if chosen.Kind == nil || *chosen.Kind != lsproto.CodeActionKindRefactorRewrite {
				t.Fatalf("kind: %+v", chosen.Kind)
			}
			if chosen.Edit == nil || chosen.Edit.DocumentChanges == nil {
				t.Fatal("refactor must create and edit files atomically")
			}
			created := lsproto.DocumentUri("")
			textByURI := map[lsproto.DocumentUri][]*lsproto.TextEdit{}
			for _, change := range *chosen.Edit.DocumentChanges {
				if change.CreateFile != nil {
					created = change.CreateFile.Uri
					if change.CreateFile.Options != nil && change.CreateFile.Options.Overwrite != nil && *change.CreateFile.Options.Overwrite {
						t.Fatal("must not overwrite existing files")
					}
				}
				if change.TextDocumentEdit != nil {
					for _, edit := range change.TextDocumentEdit.Edits {
						textByURI[change.TextDocumentEdit.TextDocument.Uri] = append(textByURI[change.TextDocumentEdit.TextDocument.Uri], edit.TextEdit)
					}
				}
			}
			target := lsconv.FileNameToDocumentURI(file.FileName().Directory().ResolveFile(tc.target))
			if created != target {
				t.Fatalf("created %s, want %s", created, target)
			}
			if got := applyEditorEdits(t, file, converters, textByURI[uri]); got != tc.want {
				t.Fatalf("source:\n%s\nwant:\n%s", got, tc.want)
			}
			edits := textByURI[target]
			if len(edits) != 1 || edits[0].NewText != tc.body {
				t.Fatalf("body edits: %+v; want %q", edits, tc.body)
			}
		})
	}
}

// Modules are moved only by a requested refactor. Invalid or unrelated source
// must not acquire a partial copy action.
func TestMoveModuleRefactorDeclinesInvalidSelections(t *testing.T) {
	for _, source := range []string{
		"namespace /*cursor*/parse { export const n = 1 }",
		"function f() { module /*cursor*/parse { export const n = 1 } }",
		"export module /*cursor*/parse { export const n = 1 }",
		"module /*cursor*/parse { export const n = 1",
		"module /*cursor*/parse {}\nmodule parse {}",
		"export const /*cursor*/n = 1",
	} {
		offset := strings.Index(source, "/*cursor*/")
		source = strings.Replace(source, "/*cursor*/", "", 1)
		_, file, service, converters := editorProgram(t, source)
		pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
		response, err := service.ProvideCodeActions(moveModuleContext(t.Context()), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        lsproto.Range{Start: pos, End: pos},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil && action.CodeAction.Title == "Move module to a .ts file" {
					t.Errorf("unsafe refactor for %q", source)
				}
			}
		}
	}
}

// The edit creates a file, so a client without that capability gets no action
// it could only apply in part.
func TestMoveModuleRefactorNeedsFileCreation(t *testing.T) {
	_, file, service, _ := editorProgram(t, "module parse { export const n = 1 }\nexport { n } from parse\n")
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction != nil && action.CodeAction.Title == "Move module to a .ts file" {
				t.Fatal("offered to a client that cannot create files")
			}
		}
	}
}
